const { chromium } = require('playwright-core');
const nodemailer = require('nodemailer').default || require('nodemailer');
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
          const ct = response.headers()['content-type'] || '';
          if (!ct.includes('application/json')) return;
          const data = await response.json();
          if (data.perfilEnGimnasio?.membresias) perfil = data.perfilEnGimnasio;
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

    if (!perfil) {
      console.log('⚠️ No se pudo obtener el perfil — esperando próxima revisión');
      return;
    }

    // ── 1. Membresía activa ───────────────────────────────────────────────
    let planActivo = null;
    for (const key in perfil.membresias) {
      const m = perfil.membresias[key];
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

    // ── 2. Cupos disponibles ──────────────────────────────────────────────
    const todasRNA = Object.values(perfil.reservasNoAsignadas || {});
    const rnaDelPlan = todasRNA.filter(r => !r.membresiaID || r.membresiaID === planActivo.membresiaID);
    const cuposDisponibles = rnaDelPlan.length > 0 ? rnaDelPlan.length : todasRNA.length;
    console.log(`📦 reservasNoAsignadas: total=${todasRNA.length}, del plan=${rnaDelPlan.length}`);

    console.log(`📋 Plan: ${planActivo.planNombre}`);
    console.log(`📅 Vigente hasta: ${planActivo.finVigencia.toLocaleDateString('es-CL')}`);
    console.log(`🎯 Cupos sin agendar: ${cuposDisponibles}`);

    if (cuposDisponibles <= 0) {
      console.log('🎉 ¡Plan completo! Todos los cupos están agendados.');
      return;
    }

    // ── 3. Fechas ya reservadas ───────────────────────────────────────────
    const fechasReservadas = new Set(
      Object.values(perfil.reservas || {})
        .filter(r => r.membresiaID === planActivo.membresiaID)
        .map(r => {
          const fi = new Date(r.fechaInicio);
          const utc = fi.getTime() + fi.getTimezoneOffset() * 60000;
          const fc = new Date(utc + (-3 * 60) * 60000);
          return `${r.fechaYMD}-${fc.getHours()}`;
        })
    );

    // ── 4. Slots pendientes sin reservar ─────────────────────────────────
    const todasLasFechas = getFechasEnPeriodo(hoy, planActivo.finVigencia);
    const slotsPendientes = todasLasFechas.filter(f => !fechasReservadas.has(f.slotKey));

    console.log(`📅 ${slotsPendientes.length} slot(s) pendientes`);

    if (slotsPendientes.length === 0) {
      console.log('🎉 ¡Todos los slots están cubiertos!');
      return;
    }

    // ── 5. Notificar los slots pendientes (hay cupos disponibles) ─────────
    // La lógica es simple: si hay cuposDisponibles > 0 y el slot no está
    // reservado → hay oportunidad de reservar → notificar.
    console.log(`\n🚨 Hay ${cuposDisponibles} cupo(s) sin agendar y ${slotsPendientes.length} slot(s) disponibles:`);

    for (const slot of slotsPendientes) {
      console.log(`   → ${slot.diaNombre} ${slot.fechaYMD} ${slot.hora}:00hrs`);
    }

    // Notificar una vez con el resumen completo
    await sendNotification(slotsPendientes, cuposDisponibles);

  } finally {
    await browser.close();
  }
}

async function sendNotification(slots, cuposDisponibles) {
  // Construir lista de slots para el mensaje
  const listaSlots = slots.slice(0, 10).map(s =>
    `${s.diaNombre} ${s.fechaYMD} ${s.hora}:00-${s.hora+1}:00hrs`
  ).join('\n');

  const listaHTML = slots.slice(0, 10).map(s =>
    `<li>${s.diaNombre} ${s.fechaYMD} — ${s.hora}:00-${s.hora+1}:00hrs</li>`
  ).join('');

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
  });

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: CONFIG.email,
    subject: `🥊 ${cuposDisponibles} cupo(s) sin agendar — ¡reserva ahora!`,
    html: `
      <h2>🥊 Tienes ${cuposDisponibles} cupo(s) sin agendar</h2>
      <p>Slots disponibles en tu plan:</p>
      <ul>${listaHTML}</ul>
      <a href="${CONFIG.boxmagicUrl}" style="background:#7c3aed;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;">
        Reservar ahora →
      </a>
    `
  });
  console.log(`📧 Email enviado con ${slots.length} slot(s)`);

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    from: 'whatsapp:+14155238886',
    to: process.env.TWILIO_WHATSAPP_TO,
    body: `🥊 Tienes ${cuposDisponibles} cupo(s) sin agendar!\n\nSlots disponibles:\n${listaSlots}\n\nReserva: ${CONFIG.boxmagicUrl}`
  });
  console.log(`💬 WhatsApp enviado`);
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
