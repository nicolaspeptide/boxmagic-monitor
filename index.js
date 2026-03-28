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

  try {
    // LOGIN
    await page.goto('https://boxmagic.cl/login');

    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForLoadState('networkidle');

    console.log('✅ Login OK');

    // 🔥 EXTRAER XSRF TOKEN
    const cookies = await context.cookies();
    const xsrf = cookies.find(c => c.name === 'XSRF-TOKEN');

    if (!xsrf) {
      console.log('❌ No XSRF token');
      return;
    }

    console.log('🔐 XSRF encontrado');

    // 🔥 USAR REQUEST INTERNO (clave)
    const request = await context.request;

    const res = await request.get('https://boxmagic.cl/schedules', {
      headers: {
        'x-xsrf-token': decodeURIComponent(xsrf.value),
        'accept': 'application/json'
      }
    });

    const text = await res.text();

    console.log('\n📡 RESPUESTA RAW:');
    console.log(text.slice(0, 2000));

  } catch (err) {
    console.error('❌ ERROR:', err.message);
  } finally {
    await browser.close();
  }
}

runMonitor();
