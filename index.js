import express from 'express';
import { chromium } from 'playwright';

const app = express();

async function runTask() {
  try {
    console.log("🚀 Ejecutando tarea...");

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto('https://example.com');
    const title = await page.title();

    console.log("✅ Título:", title);

    await browser.close();

  } catch (err) {
    console.error("❌ Error:", err.message);
  }
}

// 🔁 Ejecuta cada 5 minutos automáticamente
setInterval(runTask, 5 * 60 * 1000);

// 🔥 Ejecuta una vez al iniciar (IMPORTANTE)
runTask();

app.get('/run', async (req, res) => {
  await runTask();
  res.send("OK manual run");
});

app.listen(8080, () => {
  console.log("🌐 Servidor corriendo en puerto 8080");
});