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

  let apiDetected = false;

  // 🔥 Capturar API real
  page.on('response', async (res) => {
    const url = res.url();

    if (
      url.includes('schedule') ||
      url.includes('class') ||
      url.includes('booking') ||
      url.includes('graphql')
    ) {
      try {
        const data = await res.json();

        console.log('\n📡 API DETECTADA:', url);
        console.log('📊 DATA:', JSON.stringify(data).slice(0, 1000));

        apiDetected = true;

      } catch {}
    }
  });

  try {
    // 🌐 Test red
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

    // 🔥 Ir a schedules
    await page.goto('https://boxmagic.cl/schedules');

    console.log('📍 Entrando a schedules...');

    await page.waitForTimeout(6000);

    // 🔥 FORZAR ACTIVACIÓN FRONTEND
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(2000);

    await page.mouse.wheel(0, -2000);
    await page.waitForTimeout(2000);

    await page.click('body').catch(() => {});
    await page.waitForTimeout(4000);

    // 🔥 FALLBACK: SI NO HAY API → EXTRAER HTML
    if (!apiDetected) {
      console.log('⚠️ No se detectó API, intentando DOM...');

      const html = await page.content();

      // Buscar texto relevante
      const matches = html.match(/Entrenamiento|Clase|Horario/gi);

      if (matches) {
        console.log(`📊 Coincidencias en HTML: ${matches.length}`);
      } else {
        console.log('❌ No se encontraron clases en DOM');
      }
    }

    console.log('🏁 Fin del monitor');

  } catch (err) {
    console.error('❌ ERROR:', err.message);
  } finally {
    await browser.close();
  }
}

runMonitor();
