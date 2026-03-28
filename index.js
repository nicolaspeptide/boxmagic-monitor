import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true // cambia a false si quieres ver qué pasa
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // 🔥 CAPTURADOR DE APIs
  page.on('response', async (response) => {
    const url = response.url();

    if (
      url.includes('/api') ||
      url.includes('boxmagic') ||
      url.includes('schedules') ||
      url.includes('classes')
    ) {
      try {
        const status = response.status();
        const body = await response.text();

        console.log('\n🔥 API DETECTADA:', url);
        console.log('STATUS:', status);
        console.log('BODY:', body.substring(0, 500)); // evita logs gigantes
      } catch (e) {}
    }
  });

  // 🌐 IR AL LOGIN
  console.log('🌐 Abriendo login...');
  await page.goto('https://boxmagic.cl/login', {
    waitUntil: 'domcontentloaded'
  });

  // ⏳ esperar que cargue
  await page.waitForTimeout(3000);

  // 🔐 LOGIN (ajusta selectores si cambian)
  console.log('🔐 Iniciando sesión...');

  await page.fill('input[type="email"]', 'TU_EMAIL');
  await page.fill('input[type="password"]', 'TU_PASSWORD');

  await page.click('button[type="submit"]');

  // esperar login real
  await page.waitForTimeout(8000);

  console.log('✅ Login realizado');

  // 🚀 INTENTO DIRECTO A SCHEDULES
  console.log('🧭 Navegando directo a schedules...');
  await page.goto('https://app.boxmagic.cl/schedules', {
    waitUntil: 'domcontentloaded'
  });

  await page.waitForTimeout(5000);

  // 🔥 FALLBACK: CLICK EN MENÚ SPA
  console.log('🔎 Buscando botón de agenda/clases...');

  const elements = await page.locator('a, button').all();

  for (const el of elements) {
    try {
      const text = (await el.innerText()).toLowerCase();

      if (
        text.includes('agenda') ||
        text.includes('clase') ||
        text.includes('horario') ||
        text.includes('schedule')
      ) {
        console.log('👉 CLICK EN:', text);
        await el.click();
        break;
      }
    } catch (e) {}
  }

  // 🧠 activar lazy loading
  console.log('🖱️ Scrolleando...');
  await page.mouse.wheel(0, 3000);

  await page.waitForTimeout(10000);

  console.log('🏁 FIN DEL SCRIPT');

  await browser.close();
})();
