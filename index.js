import { chromium } from 'playwright';

const EMAIL = process.env.BOXMAGIC_EMAIL;
const PASSWORD = process.env.BOXMAGIC_PASSWORD;

async function runMonitor() {
  console.log('🚀 Iniciando monitor...');

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // 🔥 VER TODO EL TRÁFICO (clave)
  page.on('request', req => {
    const url = req.url();

    if (
      url.includes('schedule') ||
      url.includes('class') ||
      url.includes('booking') ||
      url.includes('graphql')
    ) {
      console.log('📡 REQUEST:', url);
    }
  });

  page.on('response', async res => {
    const url = res.url();

    if (url.includes('schedule') || url.includes('class')) {
      try {
        const data = await res.json();
        console.log('📊 DATA:', JSON.stringify(data).slice(0, 500));
      } catch {}
    }
  });

  try {
    // 🌐 TEST INTERNET
    console.log('🌐 Probando conexión...');
    await page.goto('https://google.com');
    console.log('✅ Internet OK');

    // 🔐 LOGIN
    await page.goto('https://boxmagic.cl/login');

    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForLoadState('networkidle');

    console.log('✅ Login OK');

    // 🔥 IR A SCHEDULES
    await page.goto('https://boxmagic.cl/schedules');

    console.log('📍 Entrando a schedules...');

    // 🔥 ESPERA BASE
    await page.waitForTimeout(4000);

    // 🔥 INTERACCIÓN REAL (ESTO ES LO CLAVE)

    // Scroll fuerte
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(2000);

    // Scroll inverso
    await page.mouse.wheel(0, -1500);
    await page.waitForTimeout(2000);

    // Clicks en divs (React trigger)
    const divs = await page.$$('div');
    for (let i = 0; i < Math.min(divs.length, 5); i++) {
      await divs[i].click().catch(() => {});
      await page.waitForTimeout(500);
    }

    // Hover (MUY importante en apps modernas)
    const body = await page.$('body');
    if (body) {
      await body.hover();
    }

    await page.waitForTimeout(5000);

    console.log('🏁 Fin del monitor');

  } catch (err) {
    console.error('❌ ERROR:', err.message);
  } finally {
    await browser.close();
  }
}

runMonitor();
