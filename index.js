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

async function getPerfil(page) {
  return new Promise(async (resolve) => {
    let perfil = null;

    const handler = async (response) => {
      if (response.url().includes('boxmagic') || response.url().includes('parse')) {
        try {
          const contentType = response.headers()['content-type'] || '';
          if (!contentType.includes('application/json')) return;
          const data = await response.json();
          if (data.perfilEnGimnasio?.membresias) {
            perfil = data.perfilEnGimnasio;
          }
        } catch(e) {}
      }
    };

    page.on('response', handler);
    await page.goto(CONFIG.perfilUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    page.off('response', handler);
    resolve(perfil);
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

    const perfil = await getPerfil(page);
    await browser.close();

    if (!perfil) {
      console.log('⚠️ No se pudo obtener el perfil — esperando próxima revisión');
      return;
    }

    // ── 1. Encontrar membresía activa ──────────────────────────────────────
    const membresias = perfil.membresias || {};
    let planActivo = null;

    for (const key in membresias) {
      const m = membresias[key];
      if (!m.activa) continue;
      const finVigencia = new Date(m.finVigencia);
      if (finVigencia < hoy) continue;
      planActivo = { ...m, membresiaID: m.membresiaID || key, finVigencia };
      break;
    }

    if (!planActivo) {
      console.log('⚠️ No hay plan activo — esperando próxima revisión');
      return;
    }

    // ── 2. Calcular cupos disponibles desde reservasNoAsignadas ───────────
    const reservasNoAsignadas = Object.values(perfil.reservasNoAsignadas || {});
    const cuposDisponibles = reservasNoAsignadas.length;

    console.log(`📋 Plan: ${planActivo.planNombre}`);
    console.log(`📅 Vigente hasta: ${planActivo.finVigencia.toLocaleDateString('es-CL')}`);
    console.log(`🎯 Cupos sin agendar: ${cuposDisponibles}`);

    if (cuposDisponibles <= 0) {
      console.log('🎉 ¡Plan completo! Todos los cupos están agendados.');
      return;
    }

    // ── 3. Fechas ya reservadas (para no notificar lo que ya está agendado) ─
    const reservas = Object.values(perfil.reservas || {});
    const fechasReservadas = new Set(
      reservas
        .filter(r => r.membresiaID === planActivo.membresiaID)
        .map(r => {
          const fechaInicio = new Date(r.fechaInicio);
          const utc = fechaInicio.getTime() + fechaInicio.getTimezoneOffset() * 60000;
          const fechaChile = new Date(utc + (-3 * 60) * 60000);
          return `${r.fechaYMD}-${fechaChile.getHours()}`;
        })
    );

    // ── 4. Slots pendientes en el período de vigencia ─────────────────────
    const todasLasFechas = getFechasEnPeriodo(hoy, planActivo.finVigencia);
    const fechasPendientes = todasLasFechas.filter(f => !fechasReservadas.has(f.slotKey));

    console.log(`📅 ${fechasPendientes.length} slot(s) pendientes hasta ${planActivo.finVigencia.toLocaleDateString('es-CL')}`);

    // ── 5. Para cada slot pendiente, navegar y capturar espaciosDisponibles ─
    // BoxMagic devuelve perfilEnGimnasio en cada navegación, pero la
    // disponibilidad de espacios está en la respuesta porIDs / instancias
    // que se dispara al cargar la vista de horarios con instanciaID.
    // Capturamos TODAS las respuestas JSON y buscamos espaciosDisponibles.

    const browser2 = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/ms-playwright/chromium-1091/chrome-linux/chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    });

    const page2 = await browser2.newPage();
    await login(page2);

    const resultados = [];

    for (const slot of fechasPendientes) {
      const { diaNombre, fechaYMD, hora, claseID, horarioID } = slot;
      const respuestas = [];

      const handler = async (response) => {
        try {
          const ct = response.headers()['content-type'] || '';
          if (!ct.includes('application/json')) return;
          const data = await response.json();
          respuestas.push({ url: response.url(), data });
        } catch(e) {}
      };

      page2.on('response', handler);
      const url = `${CONFIG.boxmagicUrl}?instanciaID=i${fechaYMD}>${claseID}>${horarioID}`;
      await page2.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      await page2.waitForTimeout(2000);
      page2.off('response', handler);

      // Buscar espaciosDisponibles en cualquier respuesta
      let espacios = null;
      let yaReservado = false;

      for (const { data } of respuestas) {
        // Buscar en instancias directas
        if (data.instancias) {
          for (const key in data.instancias) {
            const inst = data.instancias[key];
            const fi = new Date(inst.fechaInicio);
            const utc = fi.getTime() + fi.getTimezoneOffset() * 60000;
            const fc = new Date(utc + (-3 * 60) * 60000);
            if (fc.getHours() !== hora || fc.toISOString().split('T')[0] !== fechaYMD) continue;
            if (data.participantes?.[CONFIG.usuarioID]) { yaReservado = true; break; }
            espacios = inst.espaciosDisponibles;
            break;
          }
        }

        // Buscar en reservas del perfil fresco: si hay una reserva con este instanciaID → ya está reservado
        if (data.perfilEnGimnasio?.reservas) {
          const instanciaKey = `i${fechaYMD}>${claseID}>${horarioID}`;
          const reservaExistente = Object.values(data.perfilEnGimnasio.reservas).find(r =>
            r.instanciaID === instanciaKey || r.claseID === claseID && r.fechaYMD === fechaYMD
          );
          if (reservaExistente) {
            yaReservado = true;
          }
        }

        if (espacios !== null || yaReservado) break;
      }

      if (yaReservado) {
        console.log(`⏭️  ${diaNombre} ${fechaYMD} ${hora}:00hrs → Ya reservado`);
        continue;
      }

      if (espacios === null) {
        // Último recurso: asumir que hay espacio si no encontramos datos
        // (la clase existe en el sistema porque tenemos su ID)
        console.log(`❓ ${diaNombre} ${fechaYMD} ${hora}:00hrs → Sin datos de espacios`);
        continue;
      }

      console.log(`🔍 ${diaNombre} ${fechaYMD} ${hora}:00hrs → ${espacios} espacio(s)`);

      if (espacios > 0) {
        resultados.push({ ...slot, espacios });
      }

      await new Promise(r => setTimeout(r, 500));
    }

    await browser2.close();

    if (resultados.length > 0) {
      for (const r of resultados) {
        await sendNotification(r.diaNombre, r.fechaYMD, r.hora, r.espacios, cuposDisponibles);
      }
    } else {
      console.log('Sin cupos disponibles en los slots monitoreados.');
    }

  } catch(e) {
    console.error('Error en checkCupos:', e);
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
