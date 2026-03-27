const { chromium } = require('playwright-core');
const twilio = require('twilio');
const fs = require('fs');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  loginUrl:  'https://members.boxmagic.app/a/g?o=pi-e',
  perfilUrl: 'https://members.boxmagic.app/g/oGDPQaGLb5/perfil',
  email:     process.env.BOXMAGIC_EMAIL,
  password:  process.env.BOXMAGIC_PASSWORD,
};

const TWILIO = {
  sid:   process.env.TWILIO_ACCOUNT_SID,
  token: process.env.TWILIO_AUTH_TOKEN,
  to:    process.env.TWILIO_WHATSAPP_TO,
  from:  'whatsapp:+14155238886',
};

// Horarios fijos que quieres asistir
const SLOTS = [
  { dia: 1, hora: '19:00', nombre: 'Lunes 19h',     claseID: 'Vd0jxy2Lrx', horarioID: 'Kp0Myj6E08' },
  { dia: 1, hora: '20:00', nombre: 'Lunes 20h',     claseID: 'gjLKb2rDRe', horarioID: '6XD9krv342' },
  { dia: 2, hora: '19:00', nombre: 'Martes 19h',    claseID: 'wa0eq7P0v6', horarioID: 'gjLK569Q0R' },
  { dia: 2, hora: '20:00', nombre: 'Martes 20h',    claseID: '8VLZORg4za', horarioID: 'WkD16ZV3L3' },
  { dia: 3, hora: '20:00', nombre: 'Miércoles 20h', claseID: 'gjLKb2rDRe', horarioID: '8k0zNyjx0n' },
  { dia: 5, hora: '19:00', nombre: 'Viernes 19h',   claseID: 'ep4QnlK0aQ', horarioID: 'j80pX8AY0W' },
];

const ANTI_SPAM_FILE = '/app/avisos_enviados.json';

// ─── ANTI-SPAM ────────────────────────────────────────────────────────────────
// Guarda qué clases ya fueron avisadas (por fecha+horarioID)
function cargarAvisos() {
  try {
    return JSON.parse(fs.readFileSync(ANTI_SPAM_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function yaAvisado(key) {
  const avisos = cargarAvisos();
  return !!avisos[key];
}

function marcarAvisado(key) {
  const avisos = cargarAvisos();
  avisos[key] = new Date().toISOString();
  fs.writeFileSync(ANTI_SPAM_FILE, JSON.stringify(avisos), 'utf8');
}

// Limpiar avisos de fechas pasadas
function limpiarAvisosViejos() {
  const avisos = cargarAvisos();
  const hoy = new Date().toISOString().slice(0, 10);
  const limpios = {};
  for (const [key, val] of Object.entries(avisos)) {
    const fecha = key.split('_')[0];
    if (fecha >= hoy) limpios[key] = val;
  }
  fs.writeFileSync(ANTI_SPAM_FILE, JSON.stringify(limpios), 'utf8');
}

// ─── WHATSAPP ─────────────────────────────────────────────────────────────────
async function enviarWhatsApp(mensaje) {
  const client = twilio(TWILIO.sid, TWILIO.token);
  await client.messages.create({ from: TWILIO.from, to: TWILIO.to, body: mensaje });
  console.log('✅ WhatsApp enviado');
}

// ─── SCRAPING ─────────────────────────────────────────────────────────────────
async function obtenerPerfil() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page    = await context.newPage();
  let perfilData = null;

  page.on('response', async (response) => {
    try {
      const ct = response.headers()['content-type'] || '';
      if (ct.includes('application/json')) {
        const json = await response.json();
        if (json?.perfilEnGimnasio) {
          perfilData = json.perfilEnGimnasio;
          console.log('📦 Perfil interceptado');
        }
      }
    } catch {}
  });

  try {
    console.log('🔐 Iniciando login...');
    await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle' });
    await page.fill('input[type="email"], input[name="email"]', CONFIG.email);
    await page.fill('input[type="password"], input[name="password"]', CONFIG.password);
    await page.click('button[type="submit"], button:has-text("Ingresar"), button:has-text("Entrar")');
    await page.waitForTimeout(3000);
    console.log('✅ Login exitoso');

    await page.goto(CONFIG.perfilUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(8000);
  } finally {
    await browser.close();
  }

  return perfilData;
}

// ─── LÓGICA PRINCIPAL ─────────────────────────────────────────────────────────
function obtenerFechasDelPeriodo(perfil) {
  const ahora = new Date();

  const membresiaActiva = Object.values(perfil.membresias || {}).find(
    m => m.activa && new Date(m.finVigencia) > ahora
  );
  if (!membresiaActiva) return null;

  const finVigencia = new Date(membresiaActiva.finVigencia);

  // Recopilar todas las reservas ya agendadas en el período activo
  const reservasAgendadas = new Set();
  for (const pago of Object.values(membresiaActiva.pagos || {})) {
    for (const periodo of Object.values(pago.periodosDeCupos || {})) {
      for (const reserva of Object.values(periodo.reservas || {})) {
        // key: fechaYMD_horarioID
        reservasAgendadas.add(`${reserva.fechaYMD}_${reserva.horarioID}`);
      }
    }
  }

  console.log(`📋 Plan vigente hasta: ${finVigencia.toISOString().slice(0,10)}`);
  console.log(`📅 Reservas ya agendadas: ${reservasAgendadas.size}`);

  return { finVigencia, reservasAgendadas };
}

function obtenerProximasFechasParaSlot(slot, finVigencia) {
  // Devuelve todas las fechas futuras donde cae ese día de semana
  // dentro del período del plan
  const fechas = [];
  const ahora = new Date();
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());

  // Empezar desde mañana (si ya pasó la hora de hoy) o desde hoy
  const inicio = new Date(hoy);

  for (let d = new Date(inicio); d <= finVigencia; d.setDate(d.getDate() + 1)) {
    // getDay(): 0=domingo, 1=lunes... 5=viernes, 6=sábado
    if (d.getDay() === slot.dia) {
      // Verificar que la clase no haya pasado ya hoy
      const [h, m] = slot.hora.split(':').map(Number);
      const fechaClase = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
      if (fechaClase > ahora) {
        fechas.push(d.toISOString().slice(0, 10));
      }
    }
  }
  return fechas;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n⏰ ${new Date().toLocaleString('es-CL')} — Iniciando revisión...`);

  limpiarAvisosViejos();

  // 1. Obtener perfil
  let perfil;
  try {
    perfil = await obtenerPerfil();
  } catch (err) {
    console.error('❌ Error scraping:', err.message);
    return;
  }
  if (!perfil) {
    console.log('❌ No se obtuvo perfil');
    return;
  }

  // 2. Obtener datos del período
  const datos = obtenerFechasDelPeriodo(perfil);
  if (!datos) {
    console.log('⚠️  No hay membresía activa');
    return;
  }

  const { finVigencia, reservasAgendadas } = datos;

  // 3. Revisar cada slot en cada fecha futura del período
  const pendientes = [];

  for (const slot of SLOTS) {
    const fechas = obtenerProximasFechasParaSlot(slot, finVigencia);

    for (const fecha of fechas) {
      const key = `${fecha}_${slot.horarioID}`;

      // ¿Ya está agendado?
      if (reservasAgendadas.has(key)) {
        console.log(`✅ Ya agendado: ${slot.nombre} ${fecha}`);
        continue;
      }

      // ¿Ya avisamos por este?
      if (yaAvisado(key)) {
        console.log(`🔕 Ya avisado: ${slot.nombre} ${fecha}`);
        continue;
      }

      console.log(`⚠️  Pendiente: ${slot.nombre} ${fecha}`);
      pendientes.push({ slot, fecha, key });
    }
  }

  if (pendientes.length === 0) {
    console.log('✅ Todo agendado o ya avisado. Sin novedades.');
    return;
  }

  // 4. Armar mensaje WhatsApp
  const lineas = [
    `🏋️ *BoxMagic — Clases sin agendar*`,
    ``,
    `Tienes *${pendientes.length} clase${pendientes.length !== 1 ? 's' : ''} disponible${pendientes.length !== 1 ? 's' : ''}* sin reservar:`,
    ``,
  ];

  // Agrupar por fecha para que sea más legible
  const porFecha = {};
  for (const { slot, fecha } of pendientes) {
    if (!porFecha[fecha]) porFecha[fecha] = [];
    porFecha[fecha].push(slot.nombre);
  }

  for (const [fecha, nombres] of Object.entries(porFecha).sort()) {
    const [anio, mes, dia] = fecha.split('-');
    const fechaLegible = new Date(fecha + 'T12:00:00').toLocaleDateString('es-CL', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
    lineas.push(`📅 ${fechaLegible}`);
    for (const nombre of nombres) {
      lineas.push(`  • ${nombre}`);
    }
    lineas.push('');
  }

  lineas.push(`👉 Reserva en: members.boxmagic.app`);
  lineas.push(`⏰ Plan vigente hasta: ${finVigencia.toLocaleDateString('es-CL', { day: 'numeric', month: 'long' })}`);

  const mensaje = lineas.join('\n');

  // 5. Enviar WhatsApp
  try {
    await enviarWhatsApp(mensaje);
    // Marcar todos como avisados
    for (const { key } of pendientes) {
      marcarAvisado(key);
    }
  } catch (err) {
    console.error('❌ Error WhatsApp:', err.message);
  }
}

main().catch(console.error);
