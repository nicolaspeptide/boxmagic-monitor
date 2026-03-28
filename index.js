import { chromium } from 'playwright';

const URL = 'https://boxmagic.cl/login';

const EMAIL = process.env.BOXMAGIC_EMAIL;
const PASSWORD = process.env.BOXMAGIC_PASSWORD;

async function safeGoto(page, url) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      return;
    } catch (e) {
      console.log(`⚠️ Retry ${i + 1}...`);
      await page.waitForTimeout(2000);
    }
  }
  throw new Error('❌ No se pudo cargar la página');
}

async function runMonitor() {
  console.log('🚀 Iniciando monitor...');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  try {
    // LOGIN
    await safeGoto(page, URL);

    console.log('🔐 Login...');
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');

    await page.waitForLoadState('networkidle');
    console.log('✅ Login OK');

    // IR A HORARIOS
    console.log('📅 Navegando a horarios...');
    await safeGoto(page, 'https://boxmagic.cl/schedules');

    // ESPERAR QUE CARGUE ALGO REAL
    await page.waitForTimeout(5000);

    // SCROLL
    await autoScroll(page);

    // 🔥 CLAVE: seleccionar elementos visibles
    console.log('🔍 Buscando clases reales...');

    const classes = await page.$$eval('*', (nodes) =>
      nodes
        .map(n => n.innerText)
        .filter(text =>
          text &&
          (
            text.includes('Entrenamiento') ||
            text.includes('Personalizado') ||
            text.includes('No one registered') ||
            text.includes('cupos')
          )
        )
    );

    console.log(`📊 Clases encontradas: ${classes.length}`);

    classes.slice(0, 20).forEach(c => console.log('👉', c));

    console.log('🏁 Fin del monitor');

  } catch (error) {
    console.error('❌ ERROR:', error.message);
  } finally {
    await browser.close();
  }
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 500;

      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 300);
    });
  });
}

runMonitor();
