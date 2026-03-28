const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false, // 👈 ver lo que pasa (luego puedes poner true)
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // 🔥 Capturar TODAS las requests importantes
  page.on('request', (request) => {
    const url = request.url();

    if (url.includes('/boxmagic/')) {
      console.log('\n📤 REQUEST:', url);
      console.log('METHOD:', request.method());
    }
  });

  page.on('response', async (response) => {
    const url = response.url();

    if (url.includes('/boxmagic/')) {
      console.log('\n📥 RESPONSE:', url);
      console.log('STATUS:', response.status());

      try {
        const text = await response.text();
        console.log('BODY:', text.slice(0, 500)); // corta para no saturar
      } catch (e) {}
    }
  });

  // 🌐 Ir al login
  await page.goto('https://auth.boxmagic.cl/login');

  // ⏳ Esperar inputs
  await page.waitForSelector('input');

  // ⚠️ AJUSTA ESTOS SELECTORES SI CAMBIAN
  const emailInput = await page.locator('input[type="email"], input[placeholder*="Correo"]');
  const passInput = await page.locator('input[type="password"]');

  await emailInput.fill('TU_CORREO');
  await passInput.fill('TU_PASSWORD');

  // 🔥 Click login
  await Promise.all([
    page.waitForNavigation(),
    page.click('button:has-text("Ingresar"), button[type="submit"]'),
  ]);

  console.log('\n✅ LOGEADO');

  // ⏳ Esperar que cargue el sistema
  await page.waitForTimeout(5000);

  // 🔥 Ir directo a schedules (o la página que quieras)
  await page.goto('https://cualesmi.boxmagic.app/');

  await page.waitForTimeout(5000);

  console.log('\n🎯 YA ESTÁS DENTRO');

  // 👉 Aquí puedes empezar scraping
  const contenido = await page.content();
  console.log('\n📄 HTML LENGTH:', contenido.length);

  // ❌ no cerrar si quieres inspeccionar
  // await browser.close();
})();
