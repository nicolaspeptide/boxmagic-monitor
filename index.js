import { chromium } from 'playwright';

const EMAIL = process.env.BOXMAGIC_EMAIL;
const PASSWORD = process.env.BOXMAGIC_PASSWORD;

async function runMonitor() {
  console.log('🚀 Iniciando monitor...');

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // 🔥 Interceptar APIs
  page.on('response', async (response) => {
    const url = response.url();

    if (
      url.includes('schedule') ||
      url.includes('class') ||
      url.includes('booking') ||
      url.includes('api')
    ) {
      try {
        const data = await response.json();

        console.log('\n📡 API DETECTADA:', url);

        if (Array.isArray(data)) {
          console.log(`📊 Clases encontradas: ${data.length}`);

          data.slice(0, 5).forEach(c => {
            console.log('👉', JSON.stringify(c));
          });
        } else {
          console.log('📦 Data:', JSON.stringify(data).slice(0, 500));
        }

      } catch (e) {
        // silencioso (no todas las respuestas son JSON)
      }
    }
  });

  try {
    // 🌐 Test conexión
    console.log('🌐 Probando conexión...');
    await page.goto('https://google.com');
    console.log('✅ Internet OK');

    // 🔐 LOGIN
    await page.goto('https://boxmagic.cl/login', {
      waitUntil: 'domcontentloaded'
    });

    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForLoadState('networkidle');

    console.log('✅ Login OK');

    // 🔥 Ir a horarios
    await page.goto('https://boxmagic.cl/schedules', {
      waitUntil: 'domcontentloaded'
    });

    console.log('📍 Entrando a schedules...');

    // ⏱️ Esperar carga
    await page.waitForTimeout(5000);

    // 🖱️ Forzar interacción (clave en apps React)
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(2000);

    // 🖱️ Click genérico (dispara queries internas)
    const botones = await page.$$('button');
    if (botones.length > 0) {
      await botones[0].click().catch(() => {});
      console.log('🖱️ Click disparado');
    }

    await page.waitForTimeout(5000);

    console.log('🏁 Fin del monitor');

  } catch (err) {
    console.error('❌ ERROR:', err.message);
  } finally {
    await browser.close();
  }
}

runMonitor();
