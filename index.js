const { chromium } = require('playwright');
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');

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
  to:    process.env.TWILIO_WHATSAPP_TO,   // formato: whatsapp:+56912345678
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
  const hoy = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(ANTI_SPAM_FILE, hoy, 'utf8');
}

function resetearAntiSpam() {
  try { fs.unlinkSync(ANTI_SPAM_FILE); } catch {}
}

// ─── WHATSAPP ─────────────────────────────────────────────────────────────────
async function enviarWhatsApp(mensaje) {
  const client = twilio(TWILIO.sid, TWILIO.token);
  await client.messages.create({
    from: TWILIO.from,
    to:   TWILIO.to,
    body: mensaje,
  });
  console.log('✅ WhatsApp enviado:', mensaje);
}

// ─── SCRAPING ─────────────────────────────────────────────────────────────────
async function obtenerPerfil() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page    = await context.newPage();

  let perfilData = null;

  // Interceptar la respuesta del perfil
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('perfilEnGimnasio') || url.includes('/perfil')) {
      try {
        const json = await response.json();
        if (json?.perfilEnGimnasio) {
          perfilData = json.perfilEnGimnasio;
          console.log('📦 Perfil interceptado desde:', url);
        }
      } catch {}
    }
  });

  try {
    // Login
    await page.goto(CONFIG.loginUrl, { waitUntil: 'networkidle' });
    await page.fill('input[type="email"], input[name="email"]', CONFIG.email);
    await page.fill('input[type="password"], input[name="password"]', CONFIG.password);
    await page.click('button[type="submit"], button:has-text("Ingresar"), button:has-text("Entrar")');
    await page.waitForTimeout(3000);

    // Navegar al perfil para disparar la API
    await page.goto(CONFIG.perfilUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

  } finally {
    await browser.close();
  }

  return perfilData;
}

// ─── LÓGICA DE CUPOS ──────────────────────────────────────────────────────────
function calcularCupos(perfil) {
  // 1. Encontrar membresía activa
  const membresias = perfil.membresias || {};
  const membresiaActiva = Object.values(membresias).find(
    m => m.activa && m.finVigencia && new Date(m.finVigencia) > new Date()
  );

  if (!membresiaActiva) {
    console.log('⚠️  No hay membresía activa');
    return null;
  }

  console.log(`📋 Membresía activa: ${membresiaActiva.planNombre}`);
  console.log(`   Vigencia: ${membresiaActiva.inicioVigencia?.slice(0,10)} → ${membresiaActiva.finVigencia?.slice(0,10)}`);

  // 2. Encontrar el pago vigente (cuyo período incluye hoy)
  const ahora = new Date();
  const pagos = membresiaActiva.pagos || {};
  
  let pagoVigente = null;
  for (const pago of Object.values(pagos)) {
    const inicio = new Date(pago.inicioVigencia);
    const fin    = new Date(pago.finVigencia);
    if (ahora >= inicio && ahora <= fin) {
      pagoVigente = pago;
      break;
    }
  }

  // Si no hay pago vigente exacto, tomar el último pago con período más reciente
  if (!pagoVigente) {
    const pagosOrdenados = Object.values(pagos).sort(
      (a, b) => new Date(b.inicioVigencia) - new Date(a.inicioVigencia)
    );
    pagoVigente = pagosOrdenados[0];
    console.log('⚠️  Sin pago exactamente vigente, usando el más reciente');
  }

  if (!pagoVigente) {
    console.log('⚠️  No se encontró pago');
    return null;
  }

  console.log(`💳 Pago vigente: ${pagoVigente.inicioVigencia?.slice(0,10)} → ${pagoVigente.finVigencia?.slice(0,10)}`);

  // 3. Obtener el período de cupos actual (el que está dentro del pago vigente)
  const periodos = pagoVigente.periodosDeCupos || {};
  let periodoActual = null;

  for (const periodo of Object.values(periodos)) {
    const inicio = new Date(periodo.fechaInicio);
    const fin    = new Date(periodo.fechaFin);
    if (ahora >= inicio && ahora <= fin) {
      periodoActual = periodo;
      break;
    }
  }

  // Si no hay período exacto, tomar el más reciente
  if (!periodoActual) {
    const periodosOrdenados = Object.values(periodos).sort(
      (a, b) => new Date(b.fechaInicio) - new Date(a.fechaInicio)
    );
    periodoActual = periodosOrdenados[0];
  }

  if (!periodoActual) {
    console.log('⚠️  No se encontró período de cupos');
    return null;
  }

  console.log(`📅 Período: ${periodoActual.periodoID}`);

  // 4. Calcular cupos
  //    La app muestra: total_plan - reservas_del_periodo = cupos sin agendar
  //    stats.reservas = total reservas hechas en el período (agendadas + ya usadas)
  //    stats.cuposUsados = sesiones ya realizadas
  
  const totalPlan     = Object.keys(periodoActual.reservas || {}).length + 
                        (/* cupos restantes */ 0); // necesitamos el total del plan
  
  // El total de cupos del plan viene de la membresía/plan
  // Buscamos cuántos cupos tiene el plan por período
  // La forma más confiable: stats del período
  const reservasHechas = periodoActual.stats?.reservas     ?? Object.keys(periodoActual.reservas || {}).length;
  const cuposUsados    = periodoActual.stats?.cuposUsados  ?? 0;
  const cuposAgendados = reservasHechas - cuposUsados; // reservas futuras

  // Para saber el total necesitamos el planID → buscar en gimnasio.planes
  // Pero no tenemos esa info aquí, así que usamos la membresía
  // La membresía tiene planNombre que incluye "16 Sesiones"
  // Pero mejor: buscar en pagos si hay campo de cupos
  // El pago no tiene cupos directamente, pero podemos inferirlo del nombre del plan
  
  // ESTRATEGIA: contar el total de cupos del período anterior completo
  // o bien hardcodear basado en el plan activo
  // Por ahora, calculamos: cuposSinAgendar = cuposAgendados futuros
  
  // Contar reservas FUTURAS (fechaInicio > ahora) en el período actual
  const reservasFuturas = Object.values(periodoActual.reservas || {}).filter(
    r => new Date(r.fechaInicio) > ahora
  );

  // Cupos sin agendar = total_plan - reservas_hechas
  // Necesitamos el total del plan. Lo extraemos del planNombre o de stats de períodos previos completos
  // Método más robusto: buscar el total en pagos previos completos del mismo plan
  let totalCuposPlan = null;
  for (const pago of Object.values(pagos)) {
    for (const periodo of Object.values(pago.periodosDeCupos || {})) {
      if (periodo.stats?.reservas === periodo.stats?.cuposUsados && 
          periodo.stats?.reservas > 0) {
        // Este período se completó, el total es lo que se usó
        // Pero no sabemos si era el máximo...
      }
    }
  }

  // MEJOR MÉTODO: leer el número del planNombre
  const match = membresiaActiva.planNombre?.match(/(\d+)\s*Sesion/i);
  if (match) {
    totalCuposPlan = parseInt(match[1]);
  }

  const cuposSinAgendar = totalCuposPlan !== null 
    ? totalCuposPlan - reservasHechas 
    : null;

  console.log(`📊 Total plan: ${totalCuposPlan} | Reservas hechas: ${reservasHechas} | Usadas: ${cuposUsados} | Agendadas: ${cuposAgendados} | Sin agendar: ${cuposSinAgendar}`);
  console.log(`📊 Reservas futuras en período: ${reservasFuturas.length}`);

  return {
    planNombre:      membresiaActiva.planNombre,
    finVigencia:     membresiaActiva.finVigencia,
    periodoID:       periodoActual.periodoID,
    totalCuposPlan,
    reservasHechas,
    cuposUsados,
    cuposAgendados,
    cuposSinAgendar,
    reservasFuturas: reservasFuturas.length,
  };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🏋️  BoxMagic Monitor — ${new Date().toLocaleString('es-CL')}`);

  // 1. Obtener perfil
  let perfil;
  try {
    perfil = await obtenerPerfil();
  } catch (err) {
    console.error('❌ Error al obtener perfil:', err.message);
    return;
  }

  if (!perfil) {
    console.log('❌ No se pudo obtener el perfil');
    return;
  }

  // 2. Calcular cupos
  const cupos = calcularCupos(perfil);
  if (!cupos) {
    console.log('❌ No se pudo calcular cupos');
    return;
  }

  // 3. Decidir si notificar
  const sinAgendar = cupos.cuposSinAgendar;
  
  if (sinAgendar === null || sinAgendar <= 0) {
    console.log(`✅ Sin cupos disponibles (${sinAgendar}). Reseteando anti-spam.`);
    resetearAntiSpam();
    return;
  }

  if (yaAvisadoHoy()) {
    console.log(`🔕 Ya se notificó hoy. Cupos sin agendar: ${sinAgendar}`);
    return;
  }

  // 4. Enviar WhatsApp
  const finVig = new Date(cupos.finVigencia).toLocaleDateString('es-CL', {
    day: 'numeric', month: 'long'
  });

  const mensaje = [
    `🏋️ *BoxMagic — Cupos disponibles*`,
    ``,
    `📋 Plan: ${cupos.planNombre}`,
    `📅 Período: ${cupos.periodoID}`,
    ``,
    `⚠️ Tienes *${sinAgendar} cupo${sinAgendar !== 1 ? 's' : ''} sin agendar*`,
    ``,
    `📊 Detalle:`,
    `  • Total del plan: ${cupos.totalCuposPlan} sesiones`,
    `  • Ya agendadas/usadas: ${cupos.reservasHechas}`,
    `  • Próximas agendadas: ${cupos.reservasFuturas}`,
    ``,
    `⏰ Vigencia hasta: ${finVig}`,
    ``,
    `👉 Agenda en: members.boxmagic.app`,
  ].join('\n');

  try {
    await enviarWhatsApp(mensaje);
    marcarAvisadoHoy();
  } catch (err) {
    console.error('❌ Error al enviar WhatsApp:', err.message);
  }
}

main().catch(console.error);
