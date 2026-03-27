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
      // Capturar CUALQUIER respuesta JSON de boxmagic
      if (response.url().includes('boxmagic') || response.url().includes('parse')) {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (!contentType.includes('application/json')) return;

          const data = await response.json();
          console.log(`📡 URL: ${response.url()}`);
          console.log(`📦 Keys top-level: ${JSON.stringify(Object.keys(data))}`);

          // Si tiene perfilEnGimnasio, loguear estructura completa
          if (data.perfilEnGimnasio) {
            console.log('✅ Encontrado perfilEnGimnasio');
            console.log('   Keys:', JSON.stringify(Object.keys(data.perfilEnGimnasio)));

            if (data.perfilEnGimnasio.membresias) {
              const mems = data.perfilEnGimnasio.membresias;
              console.log('   Membresías keys:', JSON.stringify(Object.keys(mems)));
              for (const key of Object.keys(mems)) {
                const m = mems[key];
                console.log(`   [${key}] activa=${m.activa} nombre=${m.planNombre || m.nombre || m.plan || JSON.stringify(Object.keys(m))}`);
              }
            } else {
              console.log('   ❌ No tiene .membresias');
              console.log('   Contenido:', JSON.stringify(data.perfilEnGimnasio).substring(0, 500));
            }
          }

          // Buscar membresía activa sin filtrar por nombre
          if (data.perfilEnGimnasio?.membresias) {
            const membresias = data.perfilEnGimnasio.membresias;
            const reservas = data.perfilEnGimnasio.reservas || {};

            for (const key in membresias) {
              const m = membresias[key];
              if (!m.activa) continue; // único filtro por ahora

              const finVigencia = new Date(m.finVigencia);
              const hoy = getFechaChile();
              if (finVigencia < hoy) continue;

              const reservasDelPlan = Object.values(reservas).filter(r =>
                r.membresiaID === (m.membresiaID || key)
              );

              const fechasReservadas = new Set(
                reservasDelPlan.map(r => {
                  const fechaInicio = new Date(r.fechaInicio);
                  const utc = fechaInicio.getTime() + fechaInicio.getTimezoneOffset() * 60000;
                  const fechaChile = new Date(utc + (-3 * 60) * 60000);
                  return `${r.fechaYMD}-${fechaChile.getHours()}`;
                })
              );

              const nombre = m.planNombre || m.nombre || m.plan || 'Plan desconocido';
              const match = nombre.match(/(\d+)/);
              const totalCupos = match ? parseInt(match[1]) : 16;
              const cuposUsados = reservasDelPlan.length;

              planData = {
                membresiaID: m.membresiaID || key,
                planNombre: nombre,
                finVigencia: m.finVigencia,
                cuposDisponibles: totalCupos - cuposUsados,
                cuposUsados,
                totalCupos,
                fechasReservadas
              };

              console.log(`📋 Plan encontrado: ${nombre}`);
              console.log(`📅 Vigente hasta: ${finVigencia.toLocaleDateString('es-CL')}`);
              console.log(`🎯 Cupos: ${cuposUsados}/${totalCupos}`);
              break;
            }
          }
        } catch(e) {
          // ignorar respuestas no-JSON
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
      if (response.url().includes('porIDs')) {
        try {
          const data = await response.json();
          if (data.instancias) {
            for (const key in data.instancias) {
              const inst = data.instancias[key];

              const fechaInicio = new Date(inst.fechaInicio);
              const utc = fechaInicio.getTime() + fechaInicio.getTimezoneOffset() * 60000;
              const fechaChile = new Date(utc + (-3 * 60) * 60000);
              const horaClase = fechaChile.getHours();
              const fechaClase = fechaChile.toISOString().split('T')[0];

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
      }
    };

    page.on('response', handler);
    const url = `${CONFIG.boxmagicUrl}?instanciaID=i${fechaYMD}>${claseID}>${horarioID}`;
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
      console.log('Sin cupos disponibles.');
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
