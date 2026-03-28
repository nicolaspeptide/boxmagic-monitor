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

  try {
    // 🔥 Interceptar API
    page.on('response', async (response) => {
      const url = response.url();

      if (url.includes('schedule') || url.includes('class')) {
        try {
          const data = await response.json();

          console.log('📡 API detectada:', url);

          if (Array.isArray(data)) {
            console.log(`📊 Clases reales: ${data.length}`);

            data.slice(0, 10).forEach(c => {
              console.log('👉', JSON.stringify(c));
            });
          }

        } catch (e) {}
      }
    });

    // LOGIN
    await page.goto('https://boxmagic.cl/login');

    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForLoadState('networkidle');

    console.log('✅ Login OK');

    // Ir a horarios
    await page.goto('https://boxmagic.cl/schedules');

    // Esperar tráfico de red
    await page.waitForTimeout(8000);

    console.log('🏁 Fin del monitor');

  } catch (err) {
    console.error('❌ ERROR:', err.message);
  } finally {
    await browser.close();
  }
}

runMonitor();
