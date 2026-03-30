import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import twilio from 'twilio';

chromium.use(stealth());

const CONFIG = {
    // Railway tomará el token que pegaste en las variables
    authToken: process.env.BOXMAGIC_TOKEN,
    schedules: {
        monday: [19, 20],
        tuesday: [19, 20],
        wednesday: [20],
        friday: [19]
    }
};

const client = (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) ? twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN) : null;
const log = (msg) => console.log(`${new Date().toISOString()} | ${msg}`);

async function run() {
    log("🚀 Iniciando Motor con Inyección de Bearer Token...");
    
    if (!CONFIG.authToken) {
        log("❌ ERROR: No se encontró BOXMAGIC_TOKEN en Railway.");
        return;
    }

    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    // Inyectamos el token en todas las cabeceras para saltar el login por completo
    const context = await browser.newContext({
        extraHTTPHeaders: {
            'Authorization': `Bearer ${CONFIG.authToken.replace('Bearer ', '').trim()}`
        }
    });

    const page = await context.newPage();

    try {
        log("📅 Navegando directamente a la agenda...");
        // URL directa a la agenda basada en tus capturas
        await page.goto("https://members.boxmagic.app/schedule", { waitUntil: 'networkidle' });
        await page.waitForTimeout(6000);

        const bodyText = await page.innerText('body');
        
        if (bodyText.toLowerCase().includes('lunes') || bodyText.toLowerCase().includes('horarios')) {
            log("✅ ¡Acceso exitoso! El bot ya puede ver la agenda.");
            
            // Aquí puedes añadir la lógica de escaneo que usamos antes...
            log("🔎 Escaneando cupos para los días seleccionados...");
        } else {
            log("❌ Falló el acceso. Es posible que el token haya expirado.");
        }

    } catch (e) {
        log(`❌ ERROR: ${e.message}`);
    } finally {
        await browser.close();
        log("🧹 Monitor finalizado.");
    }
}

run();