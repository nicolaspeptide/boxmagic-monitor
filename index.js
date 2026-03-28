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

  // 🔥 Interceptar TODO
  page.on('request', req => {
    console.log('📡', req.method(), req.url());
  });

  page.on('response', async res => {
    try {
      const url = res.url();
      if (url.includes('api')) {
        console.log('📥', url);
        const text = await res.text();
        console.log(text.slice(0, 1000));
      }
    } catch (e) {}
  });

  try {
    // LOGIN
    await page.goto('https://boxmagic.cl/login');

    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForLoadState('networkidle');
    console.log('✅ Login OK');

    // 🔥 SOLO ROOT (NO app.)
    await page.goto('https://boxmagic.cl');

    // 🔥 Esperar + interacción
    await page.waitForTimeout(10000);
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
