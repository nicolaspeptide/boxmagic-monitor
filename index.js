import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

const CONFIG = {
    authToken: (process.env.BOXMAGIC_TOKEN || "").trim(),
    // Usamos la URL exacta que vemos en tu navegador exitoso
    targetUrl: "https://members.boxmagic.app/a/g/oGDPQaGLb5/horarios"
};

const log = (msg) => console.log(`${new Date().toISOString()} | ${msg}`);

async function run() {
    log("🚀 MOTOR FINAL: Validación de Identidad y Ruta");
    
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
        extraHTTPHeaders: {
            'Authorization': `Bearer ${CONFIG.authToken.replace('Bearer ', '')}`,
            'Referer': 'https://members.boxmagic.app/',
            'Origin': 'https://members.boxmagic.app'
        }
    });

    const page = await context.newPage();

    try {
        log(`📅 Navegando a ruta específica...`);
        const response = await page.goto(CONFIG.targetUrl, { waitUntil: 'networkidle' });
        
        log(`📡 Respuesta del servidor: ${response.status()}`);
        await page.waitForTimeout(7000); 

        const content = await page.content();
        
        // Verificación por contenido real de la página
        if (response.status() === 200 && (content.includes('Nicolás') || content.includes('LUN'))) {
            log("✅ ¡PROYECTO COMPLETADO! Agenda detectada y sesión activa.");
        } else {
            log(`⚠️ Falló la detección. Status: ${response.status()}. URL: ${page.url()}`);
        }
    } catch (e) {
        log(`❌ ERROR CRÍTICO: ${e.message}`);
    } finally {
        await browser.close();
        log("🏁 Proceso terminado.");
    }
}

run();