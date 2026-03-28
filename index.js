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

  // 🔥 LOG TOTAL
  page.on('request', req => {
    console.log('📡', req.method(), req.url());
  });

  page.on('response', async res => {
    const url = res.url();

    if (
      url.includes('api') ||
      url.includes('schedule') ||
      url.includes('class') ||
      url.includes('booking')
    ) {
      console.log('\n🔥 API DETECTADA:', url);

      try {
        const text = await res.text();
        console.log(text.slice(0, 1500));
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

    // 🔥 ESPERAR APP
    await page.waitForTimeout(5000);

    // 🔥 CLICK REAL (CLAVE ABSOLUTA)
    console.log('🖱️ Buscando botón schedules...');

    const botones = await page.locator('a, button').all();

    for (const b of botones) {
      const text = await b.innerText().catch(() => '');
      if (text.toLowerCase().includes('schedule') || text.toLowerCase().includes('clase')) {
        console.log('👉 CLICK en:', text);
        await b.click();
        break;
      }
    }

    // 🔥 ESPERAR CARGA REAL
    await page.waitForTimeout(10000);

    // 🔥 SCROLL (dispara lazy load)
    await page.mouse.wheel(0, 1000);
    await page.waitForTimeout(5000);

    console.log('🏁 Fin del monitor');

  } catch (err) {
    console.error('❌ ERROR:', err.message);
  } finally {
    await browser.close();
  }
}

runMonitor();
