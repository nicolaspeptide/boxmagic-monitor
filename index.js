import { chromium } from 'playwright';

async function main() {

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('🚀 Iniciando monitor...');

  // 👉 URL directa a tu dashboard
  await page.goto('https://app.boxmagic.cl/login', { waitUntil: 'networkidle' });

  // 🔐 LOGIN (AJUSTA SI ES NECESARIO)
  await page.fill('input[type="email"]', process.env.EMAIL);
  await page.fill('input[type="password"]', process.env.PASSWORD);
  await page.click('button[type="submit"]');

  await page.waitForTimeout(5000);

  console.log('✅ Login OK');

  // 👉 Ir a horarios
  await page.goto('https://app.boxmagic.cl/schedules', { waitUntil: 'networkidle' });

  await page.waitForTimeout(5000);

  console.log('📅 Navegando a horarios...');

  // 👉 SCROLL para cargar todo
  await autoScroll(page);

  console.log('📜 Scroll completo');

  // 👉 LEER DOM REAL
  const clases = await leerTarjetasDOM(page);

  console.log(`📊 Clases detectadas: ${clases.length}`);
  console.log(JSON.stringify(clases, null, 2));

  await browser.close();

  console.log('🔴 Fin del monitor');
}


// ===============================
// 🔥 PARSER REAL (EL IMPORTANTE)
// ===============================
async function leerTarjetasDOM(page) {
  return await page.evaluate(() => {

    const texto = document.body.innerText
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    const resultados = [];

    for (let i = 0; i < texto.length; i++) {

      // Detectamos "max" como ancla real
      if (texto[i].toLowerCase().includes('max')) {

        const max = parseInt(texto[i].match(/\d+/)?.[0] || '0');

        let inscritos = 0;
        let hora = null;

        // mirar alrededor (contexto)
        for (let j = i - 6; j <= i + 6; j++) {
          if (!texto[j]) continue;

          const linea = texto[j].toLowerCase();

          // inscritos
          if (linea.includes('no one')) {
            inscritos = 0;
          }

          if (/^\d+$/.test(texto[j])) {
            inscritos = parseInt(texto[j]);
          }

          // hora (captura inicio del rango)
          const matchHora = texto[j].match(/\d{1,2}:\d{2}(am|pm)/i);
          if (matchHora) {
            hora = matchHora[0];
          }
        }

        if (hora) {
          resultados.push({
            hora,
            inscritos,
            max,
            disponibles: max - inscritos
          });
        }
      }
    }

    return resultados;
  });
}


// ===============================
// 🔄 AUTO SCROLL
// ===============================
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 300;

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


// ===============================
main();
