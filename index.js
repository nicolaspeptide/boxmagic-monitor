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

  let foundClasses = false;

  // 🔥 INTERCEPTAR TODAS LAS RESPUESTAS
  page.on('response', async (res) => {
    const url = res.url();

    try {
      const contentType = res.headers()['content-type'] || '';

      if (contentType.includes('application/json')) {
        const data = await res.json();

        const text = JSON.stringify(data);

        // 🔥 FILTRO INTELIGENTE
        if (
          text.includes('class') ||
          text.includes('schedule') ||
          text.includes('booking') ||
          text.includes('slot')
        ) {
          console.log('\n📡 POSIBLE API DE CLASES');
          console.log('URL:', url);
          console.log('DATA:', text.slice(0, 1500));

          foundClasses = true;
        }
      }

    } catch {}
  });

  try {
    // 🌐 Test internet
    await page.goto('https://google.com');
    console.log('✅ Internet OK');

    // 🔐 LOGIN
    await page.goto('https://boxmagic.cl/login');

    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForLoadState('networkidle');

    console.log('✅ Login OK');

    // 📍 SCHEDULES
    await page.goto('https://boxmagic.cl/schedules');

    console.log('📍 Entrando a schedules...');

    // ⏱️ tiempo para que frontend dispare APIs
    await page.waitForTimeout(10000);

    // 🔥 FORZAR INTERACCIONES
    await page.mouse.move(300, 300);
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(3000);

    await page.mouse.wheel(0, -2000);
    await page.waitForTimeout(3000);

    if (!foundClasses) {
      console.log('❌ No se detectaron APIs con clases');
    } else {
      console.log('✅ Clases detectadas vía API');
    }

  } catch (err) {
    console.error('❌ ERROR:', err.message);
  } finally {
    await browser.close();
  }
}

runMonitor();
