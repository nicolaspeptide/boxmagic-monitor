import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

const CONFIG = {
    authToken: (process.env.BOXMAGIC_TOKEN || "").trim(),
    baseUrl: "https://members.boxmagic.app/schedule" // URL raíz de horarios
};

const log = (msg) => console.log(`${new Date().toISOString()} | ${msg}`);

async function run() {
    log("🚀 EJECUCIÓN FINAL: Navegación de Sesión Validada");
    
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
        extraHTTPHeaders: {
            'Authorization': `Bearer ${CONFIG.authToken.replace('Bearer ', '')}`
        }
    });

    const page = await context.newPage();

    try {
        log("📅 Entrando por la ruta raíz de la agenda...");
        const response = await page.goto(CONFIG.baseUrl, { waitUntil: 'networkidle' });
        
        log(`📡 Respuesta del servidor: ${response.status()}`);
        await page.waitForTimeout(8000); // Damos tiempo extra para carga de JS interno

        const content = await page.content();
        
        if (response.status() === 200 && (content.includes('Nicolás') || content.includes('LUN 30') || content.includes('horarios'))) {
            log("✅ LOGRADO: ¡Sesión activa y agenda detectada!");
            // Iniciar lógica de escaneo aquí
        } else {
            log(`⚠️ Status ${response.status()}. No se detectó la agenda. URL final: ${page.url()}`);
        }
    } catch (e) {
        log(`❌ ERROR: ${e.message}`);
    } finally {
        await browser.close();
        log("🏁 Proceso terminado.");
    }
}

run();