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
    await page.goto('https://boxmagic.cl/login');

    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForLoadState('networkidle');

    console.log('✅ Login OK');

    // 🔥 EXTRAER COOKIES
    const cookies = await context.cookies();

    console.log('\n🍪 COOKIES DE SESIÓN:');
    console.log(JSON.stringify(cookies, null, 2));

    // 🔥 EXTRAER LOCAL STORAGE
    const storage = await page.evaluate(() => {
      return Object.assign({}, localStorage);
    });

    console.log('\n📦 LOCAL STORAGE:');
    console.log(storage);

    // 🔥 EXTRAER SESSION STORAGE
    const session = await page.evaluate(() => {
      return Object.assign({}, sessionStorage);
    });

    console.log('\n📦 SESSION STORAGE:');
    console.log(session);

  } catch (err) {
    console.error('❌ ERROR:', err.message);
  } finally {
    await browser.close();
  }
}

runMonitor();
