import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  const page = await context.newPage();

  // 🔥 CAPTURAR REQUESTS
  page.on('request', req => {
    if (req.url().includes('api')) {
      console.log('➡️ REQUEST:', req.method(), req.url());
      console.log('HEADERS:', req.headers());
    }
  });

  page.on('response', async res => {
    if (res.url().includes('api')) {
      try {
        const body = await res.text();
        console.log('⬅️ RESPONSE:', res.url());
        console.log(body.slice(0, 500));
      } catch {}
    }
  });

  console.log('🔐 Login...');
  await page.goto('https://auth.boxmagic.cl/login');

  await page.fill('input[type="email"]', 'TU_EMAIL');
  await page.fill('input[type="password"]', 'TU_PASSWORD');
  await page.click('button[type="submit"]');

  await page.waitForTimeout(10000);

  // 🔥 INTENTO DE NAVEGACIÓN
  try {
    await page.goto('https://app.boxmagic.cl', { timeout: 10000 });
  } catch (e) {
    console.log('⚠️ app bloqueado, pero igual capturamos requests');
  }

  await page.waitForTimeout(10000);

  await browser.close();
})();
