import { chromium } from 'playwright';

const URL = 'https://boxmagic.cl/login';

// 👉 CONFIG (usa variables de entorno en Railway)
const EMAIL = process.env.BOXMAGIC_EMAIL;
const PASSWORD = process.env.BOXMAGIC_PASSWORD;

async function safeGoto(page, url) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      return;
    } catch (e) {
      console.log(`⚠️ Retry ${i + 1}...`);
      await page.waitForTimeout(2000);
    }
  }
  throw new Error('❌ No se pudo cargar la página');
}

async function runMonitor() {
  console.log('🚀 Iniciando monitor...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  try {
    // 🔹 1. Ir a login
    await safeGoto(page, URL);

    // 🔹 2. Login (ajusta selectores si cambian)
    console.log('🔐 Login...');
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForLoadState('networkidle');
    console.log('✅ Login OK');

    // 🔹 3. Ir a horarios
    console.log('📅 Navegando a horarios...');
    await safeGoto(page, 'https://boxmagic.cl/schedules');

    // 🔹 4. Esperar contenido
    await page.waitForTimeout(5000);

    // 🔹 5. Scroll completo
    console.log('📜 Scrolleando...');
    await autoScroll(page);

    // 🔹 6. Leer DOM
    console.log('📖 Leyendo DOM...');
    const content = await page.content();

    // 🔹 7. Buscar clases
    const matches = extractClasses(content);

    console.log(`📊 Clases detectadas: ${matches.length}`);
    matches.forEach((m) => console.log('👉', m));

    console.log('🏁 Fin del monitor');

  } catch (error) {
    console.error('❌ ERROR:', error.message);
  } finally {
    await browser.close();
  }
}

// 🔽 Scroll automático
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 500;

      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });
}

// 🔍 Extraer clases relevantes
function extractClasses(html) {
  const results = [];

  const keywords = [
    'Entrenamiento Personalizado',
    'Personalizado',
    'Training'
  ];

  keywords.forEach((k) => {
    if (html.includes(k)) {
      results.push(k);
    }
  });

  return results;
}

// ▶️ Ejecutar
runMonitor();
