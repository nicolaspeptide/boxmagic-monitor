import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

const CONFIG = {
    authToken: (process.env.BOXMAGIC_TOKEN || "").trim(),
    url: "https://members.boxmagic.app/a/g/oGDPQaGLb5/horarios" // URL exacta de tu captura
};

const log = (msg) => console.log(`${new Date().toISOString()} | ${msg}`);

async function run() {
    log("🚀 EJECUCIÓN FINAL: Verificación de Acceso Directo");
    
    if (!CONFIG.authToken) {
        log("❌ ERROR: No se encontró el token en Railway.");
        return;
    }

    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
        extraHTTPHeaders: {
            'Authorization': `Bearer ${CONFIG.authToken.replace('Bearer ', '')}`
        }
    });

    const page = await context.newPage();

    try {
        log("📅 Navegando directamente a la agenda...");
        const response = await page.goto(CONFIG.url, { waitUntil: 'networkidle' });
        
        log(`📡 Respuesta del servidor: ${response.status()}`);
        await page.waitForTimeout(5000); 

        const content = await page.content();
        
        // Buscamos elementos clave que confirmen que estamos dentro (ej. el nombre del usuario o días)
        if (content.includes('Nicolás') || content.includes('LUN 30')) {
            log("✅ ACCESO CONFIRMADO: El bot está operando dentro de tu cuenta.");
            // Aquí se activa la lógica de reserva/notificación
        } else {
            log("⚠️ El servidor respondió pero no se reconoce la agenda. Verificando URL actual...");
            log(`📍 URL Final: ${page.url()}`);
        }
    } catch (e) {
        log(`❌ ERROR: ${e.message}`);
    } finally {
        await browser.close();
        log("🏁 Proceso finalizado.");
    }
}

run();