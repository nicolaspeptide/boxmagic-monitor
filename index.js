import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import twilio from 'twilio';

chromium.use(stealth());

const CONFIG = {
    authToken: (process.env.BOXMAGIC_TOKEN || "").trim(),
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
    log("🚀 ESTRATEGIA FINAL: Inyección Directa de Sesión");
    
    if (!CONFIG.authToken || CONFIG.authToken.length < 50) {
        log("❌ ERROR: El token en Railway es demasiado corto o está vacío.");
        return;
    }

    log(`🔑 Validando Token (Inicia con: ${CONFIG.authToken.substring(0, 10)}...)`);

    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
        extraHTTPHeaders: {
            'Authorization': `Bearer ${CONFIG.authToken.replace('Bearer ', '')}`
        }
    });

    const page = await context.newPage();

    try {
        log("📅 Saltando login y yendo directo a Horarios...");
        // Usamos la URL exacta de tu captura para asegurar el dominio correcto
        await page.goto("https://members.boxmagic.app/schedule", { waitUntil: 'networkidle' });
        await page.waitForTimeout(7000); 

        const content = await page.content();
        
        // Verificación robusta de entrada
        if (content.includes('lunes') || content.includes('monday') || content.includes('horarios')) {
            log("✅ LOGRADO: Estamos dentro de la agenda.");
            
            for (const [day, hours] of Object.entries(CONFIG.schedules)) {
                log(`🔎 Buscando cupos para: ${day}`);
                // Lógica de detección de cupos aquí...
            }
        } else {
            log("❌ Error: El servidor rechazó el acceso. El token es inválido o expiró.");
            // Capturamos el error visual para diagnóstico final
            const shot = await page.screenshot({ fullPage: true });
            log(`📸 Estado actual (Base64): ${shot.toString('base64').substring(0, 50)}...`);
        }
    } catch (e) {
        log(`❌ ERROR TÉCNICO: ${e.message}`);
    } finally {
        await browser.close();
        log("🏁 Proceso terminado.");
    }
}

run();