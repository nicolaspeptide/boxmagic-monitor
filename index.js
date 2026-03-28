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

  // 🔥 INTERCEPTAR TODO LO ÚTIL
  page.on('request', req => {
    if (req.url().includes('api') || req.url().includes('class')) {
      console.log('📡 REQUEST:', req.method(), req.url());
    }
  });

  page.on('response', async res => {
    const url = res.url();

    if (url.includes('api') || url.includes('class')) {
      console.log('📥 RESPONSE:', url);

      try {
        const text = await res.text();
        console.log(text.slice(0, 1000));
      } catch (e) {}
    }
  });

  try {
    // LOGIN
    await page.goto('https://boxmagic.cl/login');

    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForLoadState('networkidle');
    console.log('✅ Login OK');

    // 🔥 IR DIRECTO A UNA RUTA REAL (NO ROOT)
    await page.goto('https://app.boxmagic.cl/schedules');

    // ⏳ Esperar carga real
    await page.waitForTimeout(10000);

    // 🔥 INTERACCIÓN FORZADA (CLAVE)
    await page.mouse.move(500, 500);
    await page.mouse.wheel(0, 500);

    await page.waitForTimeout(5000);

    console.log('🏁 Fin del monitor');

  } catch (err) {
    console.error('❌ ERROR:', err.message);
  } finally {
    await browser.close();
  }
}

runMonitor();
