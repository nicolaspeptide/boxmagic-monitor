import express from 'express';
import { chromium } from 'playwright';

const app = express();
const PORT = process.env.PORT || 3000;

// 🔹 ROOT (IMPORTANTE para Railway)
app.get('/', (req, res) => {
  res.send('🚀 boxmagic-monitor activo');
});

// 🔹 RUN (tu bot)
app.get('/run', async (req, res) => {
  try {
    console.log('🔥 Ejecutando Playwright...');

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto('https://example.com');
    const title = await page.title();

    await browser.close();

    console.log('✅ Título:', title);

    res.send(`OK - ${title}`);
  } catch (err) {
    console.error('❌ Error:', err.message);
    res.status(500).send('Error ejecutando Playwright');
  }
});

// 🚨 MUY IMPORTANTE: escuchar en 0.0.0.0
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 boxmagic-monitor corriendo en puerto ${PORT}`);
});