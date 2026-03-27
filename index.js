const { chromium } = require('playwright-core');
const twilio = require('twilio');
const fs = require('fs');

const CONFIG = {
  gimnasioID:  'oGDPQaGLb5',
  usuarioID:   'ep4Q9nWV4a',
  loginUrl:    '<https://members.boxmagic.app/a/g?o=pi-e>',
  perfilUrl:   '<https://members.boxmagic.app/g/oGDPQaGLb5/perfil>',
  horarioUrl:  '<https://members.boxmagic.app/g/oGDPQaGLb5/horarios>',
};

// Revisión cada 15 minutos
const INTERVALO_MS = 15 * 60 * 1000;

// Anti-spam persistente: sobrevive reinicios de Railway
const ESTADO_FILE = '/tmp/boxmagic_ultimo_estado.txt';

function leerUltimoMensaje() {
  try { return fs.readFileSync(ESTADO_FILE, 'utf8'); } catch(e) { return null; }
}
function guardarUltimoMensaje(msg) {
  try { fs.writeFileSync(ESTADO_FILE, msg, 'utf8'); } catch(e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Fecha/hora actual en Chile (zona horaria correcta con DST)
// ─────────────────────────────────────────────────────────────────────────────
function ahoraChile() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Convertir una fecha UTC a hora Chile
// ─────────────────────────────────────────────────────────────────────────────
function aChile(fecha) {
  return new Date(fecha.toLocaleString('en-US', { timeZone: 'America/Santiago' }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────────────────
async function login(page) {
  console.log('🔐 Iniciando login...');
  await page.goto(CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', process.env.BOXMAGIC_EMAIL);
  await page.fill('input[type="password"]', process.env.BOXMAGIC_PASSWORD);
  await page.click('button[type="submit"], button:has-text("Ingresar")');
  await page.waitForTimeout(4000);
  console.log('✅ Login exitoso');
}

// ─────────────────────────────────────────────────────────────────────────────
// Obtener perfil completo interceptando la respuesta JSON
// ─────────────────────────────────────────────────────────────────────────────
async function getPerfil(page) {
  let perfil = null;
  const handler = async (res) => {
    try {
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('application/json')) return;
      const data = await res.json();
      if (data.perfilEnGimnasio?.membresias) perfil = data.perfilEnGimnasio;
    } catch(e) {}
  };
  page.on('response', handler);
  try {
    await page.goto(CONFIG.perfilUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
  } finally {
    page.off('response', handler);
  }
  return perfil;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lógica principal
// ─────────────────────────────────────────────────────────────────────────────
async function revisar() {
  const hoy = ahoraChile();

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      || '/ms-playwright/chromium-1091/chrome-linux/chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await login(page);
    const perfil = await getPerfil(page);

    if (!perfil) {
      console.log('⚠️  No se pudo obtener el perfil');
      return;
    }

    // ── 1. Membresía activa ───────────────────────────────────────────────
    let plan = null;
    for (const key of Object.keys(perfil.membresias || {})) {
      const m = perfil.membresias[key];
      if (!m.activa) continue;
      if (new Date(m.finVigencia) < hoy) continue;
      plan = { ...m, membresiaID: m.membresiaID || key };
      break;
    }

    if (!plan) {
      console.log('⚠️  No hay plan activo');
      return;
    }

    const finVigencia = new Date(plan.finVigencia);
    console.log(`📋 Plan: ${plan.planNombre} | Vigente hasta: ${finVigencia.toLocaleDateString('es-CL')}`);

    // ── 2. Cupos sin agendar ──────────────────────────────────────────────
    // reservasNoAsignadas = cupos comprados sin clase asignada
    const cuposSinAgendar = Object.keys(perfil.reservasNoAsignadas || {}).length;
    console.log(`🎯 Cupos sin agendar: ${cuposSinAgendar}`);

    if (cuposSinAgendar === 0) {
      console.log('✅ Sin cupos disponibles — nada que notificar');
      guardarUltimoMensaje('');
      return;
    }

    // ── 3. Clases ya agendadas (para no repetirlas en el mensaje) ─────────
    const reservas = Object.values(perfil.reservas || {});
    const yaAgendadas = new Set(
      reservas.map(r => {
        const fc = aChile(new Date(r.fechaInicio));
        return `${r.fechaYMD}-${fc.getHours()}`;
      })
    );

    // ── 4. Próximas clases SIN reservar (desde hoy hasta fin de vigencia) ─
    const proximas = [];
    const cursor = new Date(hoy);
    cursor.setHours(0, 0, 0, 0);

    const SLOTS = [
      { dia: 1, diaNombre: 'Lunes',      hora: 19 },
      { dia: 1, diaNombre: 'Lunes',      hora: 20 },
      { dia: 2, diaNombre: 'Martes',     hora: 19 },
      { dia: 2, diaNombre: 'Martes',     hora: 20 },
      { dia: 3, diaNombre: 'Miércoles',  hora: 20 },
      { dia: 5, diaNombre: 'Viernes',    hora: 19 },
    ];

    while (cursor <= finVigencia && proximas.length < 15) {
      const fechaYMD = cursor.toISOString().split('T')[0];
      const diaNum   = cursor.getDay();
      for (const s of SLOTS) {
        if (s.dia !== diaNum) continue;
        const key = `${fechaYMD}-${s.hora}`;
        if (!yaAgendadas.has(key)) {
          proximas.push(`${s.diaNombre} ${fechaYMD} ${s.hora}:00hrs`);
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    if (proximas.length === 0) {
      console.log('✅ Todas las próximas clases ya están agendadas');
      return;
    }

    // ── 5. Notificar (solo si el mensaje cambió) ──────────────────────────
    const mensaje =
      `🥊 Tienes ${cuposSinAgendar} cupo(s) sin agendar!\n\n` +
      `Próximas clases disponibles:\n${proximas.slice(0, 8).join('\n')}\n\n` +
      `Reserva: ${CONFIG.horarioUrl}`;

    if (mensaje === leerUltimoMensaje()) {
      console.log('ℹ️  Sin cambios — no se reenvía WhatsApp');
      return;
    }

    guardarUltimoMensaje(mensaje);

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      from: 'whatsapp:+14155238886',
      to:   process.env.TWILIO_WHATSAPP_TO,
      body: mensaje,
    });

    console.log(`💬 WhatsApp enviado:\n${mensaje}`);

  } catch (err) {
    console.error('❌ Error en revisión:', err.message);
  } finally {
    await browser.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop principal con graceful shutdown
// ─────────────────────────────────────────────────────────────────────────────
let running = true;

async function loop() {
  while (running) {
    console.log(`\n⏰ ${ahoraChile().toLocaleString('es-CL')} — Iniciando revisión...`);
    await revisar();
    if (!running) break;
    console.log(`⏳ Próxima revisión en 15 minutos.`);
    await new Promise(r => setTimeout(r, INTERVALO_MS));
  }
  console.log('🛑 Monitor detenido.');
  process.exit(0);
}

process.on('SIGTERM', () => { running = false; });
process.on('SIGINT', () => { running = false; });

loop();
