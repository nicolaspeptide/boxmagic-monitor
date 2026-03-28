import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('response', async (response) => {
    const url = response.url();

    if (url.includes('api-j.boxmagic.app')) {
      try {
        const json = await response.json();

        console.log('\n🔥 API:', url);
        console.log(JSON.stringify(json, null, 2));

      } catch (e) {}
    }
  });

  console.log('🔐 Login...');
  await page.goto('https://auth.boxmagic.cl/login');

  await page.fill('input[type="email"]', 'TU_EMAIL');
  await page.fill('input[type="password"]', 'TU_PASSWORD');
  await page.click('button[type="submit"]');

  await page.waitForTimeout(10000);

  console.log('🏁 FIN (sin navegar a schedules)');

  await browser.close();
})();
