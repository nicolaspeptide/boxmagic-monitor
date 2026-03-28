import { chromium } from 'playwright';

const EMAIL = process.env.BOXMAGIC_EMAIL;
const PASSWORD = process.env.BOXMAGIC_PASSWORD;

async function runMonitor() {
  console.log('🚀 Iniciando monitor...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox']
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // 🔥 ESCUCHAR TODAS LAS RESPUESTAS
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

      } catch (e) {}
    }
  });

  try {
    // LOGIN
    await page.goto('https://app.boxmagic.cl/login');

    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForLoadState('networkidle');

    console.log('✅ Login OK');

    // 🔥 PASO CRÍTICO 1: ir a schedules REAL
    await page.goto('https://app.boxmagic.cl/schedules', {
      waitUntil: 'domcontentloaded'
    });

    console.log('📍 Entrando a schedules...');

    // 🔥 PASO CRÍTICO 2: esperar carga real
    await page.waitForTimeout(5000);

    // 🔥 PASO CRÍTICO 3: interacción (clave)
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(2000);

    // 🔥 PASO CRÍTICO 4: click en algo visible
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
