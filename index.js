const { chromium } = require('playwright');
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
  to:    process.env.TWILIO_WHATSAPP_TO,  // formato: whatsapp:+56912345678
  from:  'whatsapp:+14155238886',
};

const ANTI_SPAM_FILE = '/app/ultimo_aviso.txt';

// ─── ANTI-SPAM ────────────────────────────────────────────────────────────────
function yaAvisadoHoy() {
  try {
    const contenido = fs.readFileSync(ANTI_SPAM_FILE, 'utf8').trim();
    return contenido === new Date().toISOString().slice(0, 10);
  } catch {
    return false;
  }
}

function marcarAvisadoHoy() {
  fs.writeFileSync(ANTI_SPAM_FILE, new Date().toISOString().slice(0, 10), 'utf8');
}

function resetearAntiSpam() {
  try { fs.unlinkSync(ANTI_SPAM_FILE); } catch {}
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
      const url = response.url();
      if (url.includes('perfilEnGimnasio') || url.includes('/perfil')) {
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
    await page.waitForTimeout(5000);
  } finally {
    await browser.close();
  }

  return perfilData;
}

// ─── LÓGICA DE CUPOS ──────────────────────────────────────────────────────────
function calcularCupos(perfil) {
  const ahora = new Date();

  // 1. Membresía activa
  const membresiaActiva = Object.values(perfil.membresias || {}).find(
    m => m.activa && new Date(m.finVigencia) > ahora
  );
  if (!membresiaActiva) {
    console.log('⚠️  No hay membresía activa');
    return null;
  }
  console.log(`📋 Plan: ${membresiaActiva.planNombre} | Vigente hasta: ${membresiaActiva.finVigencia?.slice(0,10)}`);

  // 2. Total de cupos del plan (desde el nombre, ej: "16 Sesiones al Mes 3 a 1")
  const match = membresiaActiva.planNombre?.match(/(\d+)\s*Sesion/i);
  const totalCuposPlan = match ? parseInt(match[1]) : null;

  // 3. Pago vigente (el que cubre hoy)
  const pagos = Object.values(membresiaActiva.pagos || {});
  let pagoVigente = pagos.find(p =>
    ahora >= new Date(p.inicioVigencia) && ahora <= new Date(p.finVigencia)
  );
  if (!pagoVigente) {
    pagoVigente = pagos.sort((a, b) => new Date(b.inicioVigencia) - new Date(a.inicioVigencia))[0];
    console.log('⚠️  Usando pago más reciente como fallback');
  }
  if (!pagoVigente) {
    console.log('⚠️  No se encontró pago');
    return null;
  }

  // 4. Período de cupos vigente
  const periodos = Object.values(pagoVigente.periodosDeCupos || {});
  let periodoActual = periodos.find(p =>
    ahora >= new Date(p.fechaInicio) && ahora <= new Date(p.fechaFin)
  );
  if (!periodoActual) {
    periodoActual = periodos.sort((a, b) => new Date(b.fechaInicio) - new Date(a.fechaInicio))[0];
    console.log('⚠️  Usando período más reciente como fallback');
  }
  if (!periodoActual) {
    console.log('⚠️  No se encontró período de cupos');
    return null;
  }
  console.log(`📅 Período activo: ${periodoActual.periodoID}`);

  // 5. Calcular cupos
  //    La app muestra: total_plan - reservas_del_periodo = cupos sin agendar
  const reservasHechas  = periodoActual.stats?.reservas    ?? Object.keys(periodoActual.reservas || {}).length;
  const cuposUsados     = periodoActual.stats?.cuposUsados ?? 0;
  const cuposSinAgendar = totalCuposPlan !== null ? totalCuposPlan - reservasHechas : null;
  const reservasFuturas = Object.values(periodoActual.reservas || {}).filter(
    r => new Date(r.fechaInicio) > ahora
  ).length;

  console.log(`📊 Total: ${totalCuposPlan} | Hechas: ${reservasHechas} | Usadas: ${cuposUsados} | Futuras: ${reservasFuturas} | Sin agendar: ${cuposSinAgendar}`);

  return {
    planNombre: membresiaActiva.planNombre,
    finVigencia: membresiaActiva.finVigencia,
    periodoID: periodoActual.periodoID,
    totalCuposPlan,
    reservasHechas,
    cuposUsados,
    cuposSinAgendar,
    reservasFuturas,
  };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n⏰ ${new Date().toLocaleString('es-CL')} — Iniciando revisión...`);

  // 1. Scraping
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

  // 2. Calcular cupos
  const cupos = calcularCupos(perfil);
  if (!cupos) {
    console.log('❌ No se pudo calcular cupos');
    return;
  }

  const sinAgendar = cupos.cuposSinAgendar;

  // 3. Si no hay cupos libres, resetear anti-spam y salir
  if (sinAgendar === null || sinAgendar <= 0) {
    console.log(`✅ Cupos sin agendar: ${sinAgendar}. Todo agendado.`);
    resetearAntiSpam();
    return;
  }

  // 4. Anti-spam: solo notificar una vez por día
  if (yaAvisadoHoy()) {
    console.log(`🔕 Ya se notificó hoy — cupos sin agendar: ${sinAgendar}`);
    return;
  }

  // 5. Armar y enviar WhatsApp
  const finVig = new Date(cupos.finVigencia).toLocaleDateString('es-CL', {
    day: 'numeric', month: 'long',
  });

  const mensaje = [
    `🏋️ *BoxMagic — Cupos disponibles*`,
    ``,
    `📋 Plan: ${cupos.planNombre}`,
    `📅 Período: ${cupos.periodoID}`,
    ``,
    `⚠️ Tienes *${sinAgendar} cupo${sinAgendar !== 1 ? 's' : ''} sin agendar*`,
    ``,
    `📊 Detalle del período:`,
    `  • Total: ${cupos.totalCuposPlan} sesiones`,
    `  • Ya realizadas: ${cupos.cuposUsados}`,
    `  • Próximas agendadas: ${cupos.reservasFuturas}`,
    `  • Sin agendar: ${sinAgendar}`,
    ``,
    `⏰ Vigencia hasta: ${finVig}`,
    `👉 Agenda en: members.boxmagic.app`,
  ].join('\n');

  try {
    await enviarWhatsApp(mensaje);
    marcarAvisadoHoy();
  } catch (err) {
    console.error('❌ Error WhatsApp:', err.message);
  }
}

main().catch(console.error);
