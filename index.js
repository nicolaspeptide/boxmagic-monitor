import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // 🔥 FILTRO PROFESIONAL (SOLO APIs REALES)
  page.on('response', async (response) => {
    const url = response.url();

    if (url.includes('api-j.boxmagic.app')) {
      try {
        const status = response.status();

        if (status !== 200) return;

        const contentType = response.headers()['content-type'] || '';

        // SOLO JSON (NO JS, NO HTML)
        if (!contentType.includes('application/json')) return;

        const body = await response.json();

        console.log('\n🔥 API REAL:', url);
        console.log('DATA:', JSON.stringify(body, null, 2));

      } catch (e) {}
    }
  });

  console.log('🌐 Abriendo login...');
  await page.goto('https://boxmagic.cl/login');

  await page.waitForTimeout(3000);

  console.log('🔐 Login...');
  await page.fill('input[type="email"]', 'TU_EMAIL');
  await page.fill('input[type="password"]', 'TU_PASSWORD');
  await page.click('button[type="submit"]');

  await page.waitForTimeout(8000);

  console.log('🚀 Ir a schedules...');
  await page.goto('https://app.boxmagic.cl/schedules');

  // 🔥 IMPORTANTE: esperar actividad real
  await page.waitForTimeout(15000);

  console.log('🏁 FIN');

  await browser.close();
})();
