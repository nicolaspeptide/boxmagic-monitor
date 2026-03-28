require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const twilio = require('twilio');

// ================= CONFIG =================

const EMAIL = process.env.BOXMAGIC_EMAIL;
const PASSWORD = process.env.BOXMAGIC_PASSWORD;

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const WHATSAPP_TO = process.env.TWILIO_WHATSAPP_TO;

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const AVISOS_FILE = '/app/avisos_enviados.json';

// Slots objetivo
const SLOTS = [
  { dia: 1, hora: '19:00', nombre: 'Lunes 19h' },
  { dia: 1, hora: '20:00', nombre: 'Lunes 20h' },
  { dia: 2, hora: '19:00', nombre: 'Martes 19h' },
  { dia: 2, hora: '20:00', nombre: 'Martes 20h' },
  { dia: 3, hora: '20:00', nombre: 'Miercoles 20h' },
  { dia: 5, hora: '19:00', nombre: 'Viernes 19h' }
];

// ================= HELPERS =================

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function normalizarHora(hora) {
  const [h, m] = hora.split(':').map(Number);
  const periodo = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, '0')}${periodo}`;
}

function cargarAvisos() {
  if (!fs.existsSync(AVISOS_FILE)) return {};
  return JSON.parse(fs.readFileSync(AVISOS_FILE));
}

function guardarAvisos(data) {
  fs.writeFileSync(AVISOS_FILE, JSON.stringify(data, null, 2));
}

// ================= TWILIO =================

async function enviarWhatsApp(mensaje) {
  try {
    await client.messages.create({
      from: 'whatsapp:+14155238886',
      to: WHATSAPP_TO,
      body: mensaje
    });
    log(`📩 WhatsApp enviado: ${mensaje}`);
  } catch (e) {
    log(`❌ Error WhatsApp: ${e.message}`);
  }
}

// ================= SCRAPER =================

async function leerTarjetasDOM(page) {
  return await page.evaluate(() => {
    const resultados = [];

    const elementos = Array.from(document.querySelectorAll('*'))
      .filter(el => el.innerText && el.innerText.includes('Participants'));

    for (const el of elementos) {
      const contenedor = el.closest('div');
      if (!contenedor) continue;

      const texto = contenedor.innerText;

      const match = texto.match(/(\d+)\s*max.*?(\d+)\s*Participants.*?(\d{1,2}:\d{2}(am|pm))/i);

      if (!match) continue;

      const max = parseInt(match[1]);
      const inscritos = parseInt(match[2]);
      const hora = match[3];

      resultados.push({
        texto,
        max,
        inscritos,
        disponibles: max - inscritos,
        hora
      });
    }

    return resultados;
  });
}

// ================= MAIN =================

(async () => {
  log('🚀 Iniciando monitor...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    // LOGIN
    log('🔐 Login...');
    await page.goto('https://members.boxmagic.app/a/g?o=pi-e', { waitUntil: 'networkidle' });

    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);

    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle' })
    ]);

    log('✅ Login OK');

    // IR A HORARIOS
    log('📅 Navegando a horarios...');
    await page.goto('https://members.boxmagic.app/a/g/oGDPQaGLb5/horarios', {
      waitUntil: 'networkidle'
    });

    await sleep(3000);

    // LEER CLASES
    log('🔎 Leyendo DOM...');
    const clases = await leerTarjetasDOM(page);

    log(`📊 Clases encontradas: ${clases.length}`);
    console.log(clases);

    const avisos = cargarAvisos();
    const hoy = new Date().toISOString().slice(0, 10);

    for (const slot of SLOTS) {
      const horaNorm = normalizarHora(slot.hora);

      const clase = clases.find(c => c.hora === horaNorm);

      if (!clase) {
        log(`⚠️ No encontrada: ${slot.nombre}`);
        continue;
      }

      log(`🧠 ${slot.nombre}: ${clase.inscritos}/${clase.max}`);

      if (clase.disponibles > 0) {
        const key = `${hoy}_${slot.nombre}`;

        if (!avisos[key]) {
          await enviarWhatsApp(`🔥 CUPO DISPONIBLE: ${slot.nombre}`);
          avisos[key] = true;
        } else {
          log(`🔁 Ya avisado: ${slot.nombre}`);
        }
      }
    }

    guardarAvisos(avisos);

  } catch (e) {
    log(`❌ ERROR: ${e.message}`);
  } finally {
    await browser.close();
    log('🛑 Fin del monitor');
  }
})();
