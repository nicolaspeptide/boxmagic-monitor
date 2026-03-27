const { chromium } = require('playwright-core');
const twilio = require('twilio');
const fs = require('fs');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  loginUrl:  'https://members.boxmagic.app/a/g?o=pi-e',
  perfilUrl: 'https://members.boxmagic.app/g/oGDPQaGLb5/perfil',
  gimnasioID: 'oGDPQaGLb5',
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
function cargarAvisos() {
  try { return JSON.parse(fs.readFileSync(ANTI_SPAM_FILE, 'utf8')); } catch { return {}; }
}

function yaAvisado(key) {
  return !!cargarAvisos()[key];
}

function marcarAvisado(key) {
  const avisos = cargarAvisos();
  avisos[key] = new Date().toISOString();
  fs.writeFileSync(ANTI_SPAM_FILE, JSON.stringify(avisos), 'utf8');
}

function limpiarAvisosViejos() {
  const avisos = cargarAvisos();
  const hoy = new Date().toISOString().slice(0, 10);
  const limpios = {};
  for (const [key, val] of Object.entries(avisos)) {
    if (key.split('_')[0] >= hoy) limpios[key] = val;
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
async function obtenerPerfilYToken() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const page    = await context.newPage();

  let perfilData = null;
  let authToken  = null;

  // Capturar token de las requests
  page.on('request', (request) => {
    const auth = request.headers()['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
      authToken = auth.replace('Bearer ', '');
    }
  });

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

  return { perfilData, authToken };
}

// ─── CONSULTAR CUPOS VÍA API ──────────────────────────────────────────────────
async function consultarCupos(instancias, authToken) {
  const url = `https://api-bh.boxmagic.app/boxmagic/gimnasio/${CONFIG.gimnasioID}/instanc
