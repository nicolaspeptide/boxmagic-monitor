const { chromium } = require('playwright-core');
const nodemailer = require('nodemailer');
const twilio = require('twilio');

const CONFIG = {
  email: 'ncerdagaldames@gmail.com',
  gimnasioID: 'oGDPQaGLb5',
  usuarioID: 'ep4Q9nWV4a',
  loginUrl: 'https://members.boxmagic.app/a/g?o=pi-e',
  boxmagicUrl: 'https://members.boxmagic.app/g/oGDPQaGLb5/horarios',
  perfilUrl: 'https://members.boxmagic.app/g/oGDPQaGLb5/perfil',
  slots: [
    { dia: 1, diaNombre: 'Lunes',     hora: 19, claseID: 'Vd0jxy2Lrx', horarioID: 'Kp0Myj6E08' },
    { dia: 1, diaNombre: 'Lunes',     hora: 20, claseID: 'gjLKb2rDRe', horarioID: '6XD9krv342' },
    { dia: 2, diaNombre: 'Martes',    hora: 19, claseID: 'wa0eq7P0v6', horarioID: 'gjLK569Q0R' },
    { dia: 2, diaNombre: 'Martes',    hora: 20, claseID: '8VLZORg4za', horarioID: 'WkD16ZV3L3' },
    { dia: 3, diaNombre: 'Miércoles', hora: 20, claseID: 'gjLKb2rDRe', horarioID: '8k0zNyjx0n' },
    { dia: 5, diaNombre: 'Viernes',   hora: 19, claseID: 'ep4QnlK0aQ', horarioID: 'j80pX8AY0W' },
  ]
};

const INTERVALO_MINUTOS = 15;

function getFechaChile() {
  const ahora = new Date();
  const utc = ahora.getTime() + ahora.getTimezoneOffset() * 60000;
  return new Date(utc + (-3 * 60) * 60000);
}

function getFechasEnPeriodo(inicio, fin) {
  const fechas = [];
  const cursor = new Date(inicio);
  cursor.setHours(0, 0, 0, 0);
  const finDate = new Date(fin);

  while (cursor <= finDate) {
    const diaNum = cursor.getDay();
    const fechaYMD = cursor.toISOString().split('T')[0];
    for (const slot of CONFIG.slots) {
      if (slot.dia === diaNum) {
        fechas.push({ ...slot, fechaYMD, slotKey: `${fechaYMD}-${slot.hora}` });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return fechas;
}

async function login(page) {
  console.log('🔐 Iniciando login...');
  await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.fill('input[type="email"], input[name="email"], input:first-of-type', process.env.BOXMAGIC_EMAIL);
  await page.fill('input[type="password"], input[name="password"]', process.env.BOXMAGIC_PASSWORD);
  await page.click('button[type="submit"], button:has-text("Ingresar")');
  await page.waitForTimeout(4000);
  console.log('✅ Login exitoso');
}

async function getPlanActivo(page) {
  return new Promise(async (resolve) => {
    let planData = null;

    const handler = async (response) => {
      if (response.url().includes('boxmagic') || response.url().includes('parse')) {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (!contentType.includes('application/json')) return;

          const data = await response.json();

          if (data.perfilEnGimnasio?.membresias) {
            const perfil = data.perfilEnGimnasio;

            // DEBUG: ver todas las keys del perfil para encontrar donde están los cupos
            console.log('📦 Keys de perfilEnGimnasio:', JSON.stringify(Object.keys(perfil)));

            // Ver si hay periodos, cupos, resumen, etc.
            if (perfil.periodos) console.log('   periodos keys:', JSON.stringify(Object.keys(perfil.periodos)).substring(0, 200));
            if (perfil.cupos) console.log('   cupos:', JSON.stringify(perfil.cupos).substring(0, 200));
            if (perfil.resumen) console.log('   resumen:', JSON.stringify(perfil.resumen).substring(0, 200));
            if (perfil.estadoCupos) console.log('   estadoCupos:', JSON.stringify(perfil.estadoCupos).substring(0, 200));

            const membresias = perfil.membresias;
            const reservas = perfil.reservas || {};

            for (const key in membresias) {
              const m = membresias[key];
              if (!m.activa) continue;

              const finVigencia = new Date(m.finVigencia);
              const hoy = getFechaChile();
              if (finVigencia < hoy) continue;

              const membresiaID = m.membresiaID || key;
              const nombre = m.planNombre || m.nombre || m.plan || 'Plan desconocido';

              // Reservas para fechasReservadas
              const reservasDelPlan = Object.values(reservas).filter(r =>
                r.membresiaID === membresiaID
              );

              const fechasReservadas = new Set(
                reservasDelPlan.map(r => {
                  const fechaInicio = new Date(r.fechaInicio);
                  const utc = fechaInicio.getTime() + fechaInicio.getTimezoneOffset() * 60000;
                  const fechaChile = new Date(utc + (-3 * 60) * 60000);
                  return `${r.fechaYMD}-${fechaChile.getHours()}`;
                })
              );

              // Buscar cupos en periodos si existen
              let cuposDisponibles = 1; // fallback seguro
              if (perfil.periodos) {
                for (const pKey in perfil.periodos) {
                  const p = perfil.periodos[pKey];
                  if (p.membresiaID === membresiaID) {
                    console.log('   Periodo keys:', JSON.stringify(Object.keys(p)));
                    cuposDisponibles =
                      p.cuposSinAgendar ??
                      p.cuposDisponibles ??
                      p.cuposRestantes ??
                      (p.cuposMaxMes != null ? p.cuposMaxMes - (p.cuposAgendados || 0) - (p.cuposDescontados || 0) : 1);
                    console.log(`   Cupos desde periodo: ${cuposDisponibles}`);
                    break;
                  }
                }
              }

              planData = {
                membresiaID,
                planNombre: nombre,
                finVigencia: m.finVigencia,
                cuposDisponibles,
                fechasReservadas
              };

              console.log(`📋 Plan: ${nombre}`);
              console.log(`📅 Vigente hasta: ${finVigencia.toLocaleDateString('es-CL')}`);
              console.log(`🎯 Cupos disponibles: ${cuposDisponibles}`);
              break;
            }
          }
        } catch(e) {
          // ignorar no-JSON
        }
      }
    };

    page.on('response', handler);
    await page.goto(CONFIG.perfilUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    page.off('response', handler);
    resolve(planData);
  });
}

async function checkSlot(page, { diaNombre, fechaYMD, hora, claseID, horarioID }) {
  return new Promise(async (resolve) => {
    let resultado = null;

    const handler = async (response) => {
      const url = response.url();
      try {
        const contentType = response.headers()['content-type'] || '';
        if (!contentType.includes('application/json')) return;

        const data = await response.json();
        const keys = Object.keys(data);

        // DEBUG: ver qué respuestas llegan al navegar al slot
        if (keys.length > 0 && (url.includes('boxmagic') || url.includes('parse'))) {
          console.log(`   📡 checkSlot response: ${url.split('/').slice(-2).join('/')} keys=${JSON.stringify(keys)}`);
        }

        if (data.instancias) {
          const instKeys = Object.keys(data.instancias);
          console.log(`   instancias encontradas: ${instKeys.length}`);

          for (const key in data.instancias) {
            const inst = data.instancias[key];

            const fechaInicio = new Date(inst.fechaInicio);
            const utc = fechaInicio.getTime() + fechaInicio.getTimezoneOffset() * 60000;
            const fechaChile = new Date(utc + (-3 * 60) * 60000);
            const horaClase = fechaChile.getHours();
            const fechaClase = fechaChile.toISOString().split('T')[0];

            console.log(`   inst ${key}: fecha=${fechaClase} hora=${horaClase} (buscando ${fechaYMD} ${hora})`);

            if (horaClase !== hora || fechaClase !== fechaYMD) continue;

            const yaReservado = data.participantes && data.participantes[CONFIG.usuarioID];
            if (yaReservado) {
              console.log(`⏭️  ${diaNombre} ${fechaYMD} ${hora}:00hrs → Ya reservado`);
              resultado = { reservado: true };
              continue;
            }

            const espacios = inst.espaciosDisponibles;
            console.log(`🔍 ${diaNombre} ${fechaYMD} ${hora}:00hrs → ${espacios} espacio(s)`);
            resultado = { reservado: false, espacios };
          }
        }
      } catch(e) {}
    };

    page.on('response', handler);
    const url = `${CONFIG.boxmagicUrl}?instanciaID=i${fechaYMD}>${claseID}>${horarioID}`;
    console.log(`🌐 Navegando a slot: ${diaNombre} ${fechaYMD} ${hora}h`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    page.off('response', handler);
    resolve(resultado);
  });
}

async function checkCupos() {
  const hoy = getFechaChile();

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/ms-playwright/chromium-1091/chrome-linux/chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    await login(page);

    const plan = await getPlanActivo(page);

    if (!plan) {
      console.log('⚠️ No hay plan activo — esperando próxima revisión');
      return;
    }

    if (plan.cuposDisponibles <= 0) {
      console.log('🎉 ¡Plan completo! Todos los cupos están agendados.');
      return;
    }

    const todasLasFechas = getFechasEnPeriodo(hoy, new Date(plan.finVigencia));
    const fechasPendientes = todasLasFechas.filter(f => !plan.fechasReservadas.has(f.slotKey));

    console.log(`📅 ${fechasPendientes.length} slot(s) pendientes hasta ${new Date(plan.finVigencia).toLocaleDateString('es-CL')}`);

    const resultados = [];

    for (const slot of fechasPendientes) {
      const resultado = await checkSlot(page, slot);

      if (!resultado) {
        console.log(`⚠️  ${slot.diaNombre} ${slot.fechaYMD} ${slot.hora}:00hrs → Sin datos`);
        continue;
      }

      if (resultado.reservado) continue;

      if (resultado.espacios > 0) {
        resultados.push({ ...slot, espacios: resultado.espacios });
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    if (resultados.length > 0) {
      for (const r of resultados) {
        await sendNotification(r.diaNombre, r.fechaYMD, r.hora, r.espacios, plan.cuposDisponibles);
      }
    } else {
      console.log('Sin cupos disponibles en los slots monitoreados.');
    }

  } finally {
    await browser.close();
  }
}

async function sendNotification(dia, fechaYMD, hora, cupos, cuposRestantesPlan) {
  const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: CONFIG.email,
    subject: `🥊 ¡Cupo disponible ${dia} ${fechaYMD} ${hora}:00hrs!`,
    html: `<h2>¡Hay ${cupos} cupo(s) disponible(s)!</h2>
           <p>${dia} ${fechaYMD} — ${hora}:00-${hora+1}:00hrs</p>
           <p>Te quedan <b>${cuposRestantesPlan}</b> cupo(s) en tu plan.</p>
           <a href="${CONFIG.boxmagicUrl}">Reservar ahora →</a>`
  });
  console.log(`📧 Email enviado: ${dia} ${fechaYMD} ${hora}:00hrs`);

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: 'whatsapp:+14155238886',
    to: process.env.TWILIO_WHATSAPP_TO,
    body: `🥊 ¡Cupo disponible!\n${dia} ${fechaYMD}\n${hora}:00-${hora+1}:00hrs\n${cupos} espacio(s)\nTe quedan ${cuposRestantesPlan} cupos en tu plan\nReserva: ${CONFIG.boxmagicUrl}`
  });
  console.log(`💬 WhatsApp enviado: ${dia} ${fechaYMD} ${hora}:00hrs`);
}

async function loop() {
  while (true) {
    console.log(`\n⏰ ${getFechaChile().toLocaleString('es-CL')} — Iniciando revisión...`);
    await checkCupos().catch(console.error);
    console.log(`⏳ Próxima revisión en ${INTERVALO_MINUTOS} minutos.`);
    await new Promise(r => setTimeout(r, INTERVALO_MINUTOS * 60 * 1000));
  }
}

loop();
