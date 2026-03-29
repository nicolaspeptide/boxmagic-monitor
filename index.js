import express from 'express';
import { chromium } from 'playwright';
import twilio from 'twilio';

const app = express();
const PORT = process.env.PORT || 3000;

// 🔐 Variables de entorno (configura en Railway)
const EMAIL = process.env.BOXMAGIC_EMAIL;
const PASSWORD = process.env.BOXMAGIC_PASSWORD;
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const WHATSAPP_TO = process.env.TWILIO_WHATSAPP_TO;

// 📲 Twilio client
const client = twilio(TWILIO_SID, TWILIO_TOKEN);

// 🧠 Memoria simple para evitar spam (reinicia con el contenedor)
let ultimaAlerta = null;

// 🎯 Horarios objetivo (día + hora)
const horariosObjetivo = [
  { dia: 'lunes', horas: ['7:00pm', '8:00pm'] },
  { dia: 'martes', horas: ['7:00pm', '8:00pm'] },
  { dia: 'miércoles', horas: ['8:00pm'] },
  { dia: 'viernes', horas: ['7:00pm'] }
];

// 🧠 Helpers
function normalizarTexto(t) {
  return t.toLowerCase().replace(/\s+/g, ' ').trim();
}

function esHorarioObjetivo(texto) {
  const t = normalizarTexto(texto);
  return horariosObjetivo.some(h =>
    t.includes(h.dia) && h.horas.some(hh => t.includes(hh))
  );
}

function hayCupo(texto) {
  const t = normalizarTexto(texto);
  // Ej: "3 espacios disponibles"
  if (t.includes('espacios')) {
    const match = t.match(/(\d+)\s*espacios/);
    if (match) {
      const n = parseInt(match[1], 10);
      return n > 0;
    }
  }
  // "capacidad completa" => no hay cupo
  if (t.includes('capacidad completa')) return false;
  return false;
}

function yaEstoyInscrito(textoClase, reservas) {
  const t = normalizarTexto(textoClase);
  return reservas.some(r => normalizarTexto(r).includes(t));
}

// 🚀 Motor principal
async function runMonitor() {
  let browser;
  try {
    console.log('🚀 Ejecutando monitor...');

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    // 🔐 LOGIN
    await page.goto('https://members.boxmagic.app/a/g?o=pi-e', { waitUntil: 'domcontentloaded' });
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(5000);

    // 📍 PERFIL (tus reservas)
    await page.goto('https://members.boxmagic.app/a/g/oGDPQaGLb5/perfil?o=a-iugpd', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);

    const misReservas = await page.$$eval('*', nodes =>
      nodes.map(n => n.innerText).filter(Boolean)
    );

    // 📅 HORARIOS
    await page.goto('https://members.boxmagic.app/a/g/oGDPQaGLb5/horarios', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    const clases = await page.$$eval('*', nodes =>
      nodes
        .map(n => n.innerText)
        .filter(t =>
          t &&
          t.toLowerCase().includes('entrenamiento') &&
          (t.toLowerCase().includes('espacios') || t.toLowerCase().includes('capacidad'))
        )
    );

    // 🧠 FILTRO CENTRAL
    const clasesValidas = clases.filter(c => {
      const objetivo = esHorarioObjetivo(c);
      const disponible = hayCupo(c);
      const inscrito = yaEstoyInscrito(c, misReservas);
      return objetivo && disponible && !inscrito;
    });

    console.log('📊 Clases válidas:', clasesValidas.length);

    // 🚨 ALERTA
    if (clasesValidas.length > 0) {
      const mensaje = `🚨 Cupo disponible!\n\n${clasesValidas[0]}`;

      if (mensaje !== ultimaAlerta) {
        ultimaAlerta = mensaje;

        await client.messages.create({
          body: mensaje,
          from: 'whatsapp:+14155238886',
          to: WHATSAPP_TO
        });

        console.log('📲 WhatsApp enviado');
      } else {
        console.log('🔁 Evitando alerta duplicada');
      }
    } else {
      console.log('❌ No hay cupos relevantes');
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    if (browser) await browser.close();
    console.log('🧹 Fin ejecución\n');
  }
}

// 🌐 Endpoint manual
app.get('/run', async (req, res) => {
  await runMonitor();
  res.send('OK');
});

// 🌐 Health check
app.get('/', (req, res) => {
  res.send('boxmagic-monitor activo');
});

// 🔁 Auto-ejecución cada 5 minutos
setInterval(runMonitor, 5 * 60 * 1000);

// 🔥 Ejecuta al iniciar
runMonitor();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Servidor corriendo en puerto ${PORT}`);
<<<<<<< HEAD
});
=======
<<<<<<< HEAD
});
=======
});
>>>>>>> 30e1cd9 (fix: add twilio dependency)
>>>>>>> HEAD@{1}
