import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('🔐 Login...');
  await page.goto('https://auth.boxmagic.cl/login');

  await page.fill('input[type="email"]', 'TU_EMAIL');
  await page.fill('input[type="password"]', 'TU_PASSWORD');
  await page.click('button[type="submit"]');

  await page.waitForTimeout(8000);

  // 🔥 EXTRAER TOKEN
  const token = await page.evaluate(() => {
    return localStorage.getItem('token') ||
           sessionStorage.getItem('token');
  });

  console.log('🧠 TOKEN:', token);

  // 🔥 LLAMADA DIRECTA A API
  const data = await page.evaluate(async (token) => {
    const res = await fetch('https://api-j.boxmagic.app/boxmagic/schedules', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    return res.json();
  }, token);

  console.log('🔥 DATA REAL:', JSON.stringify(data, null, 2));

  await browser.close();
})();
