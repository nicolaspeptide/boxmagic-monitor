import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import twilio from 'twilio';

chromium.use(stealth());

const CONFIG = {
    // El .trim() elimina espacios accidentales al inicio o final
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
        log("❌ ERROR: El token en Railway es inválido o está vacío.");
        return;
    }

    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
        extraHTTPHeaders: {
            // Aquí forzamos el formato correcto que espera BoxMagic
            'Authorization': `Bearer ${CONFIG.authToken.replace('Bearer ', '')}`
        }
    });

    const page = await context.newPage();

    try {
        log("📅 Saltando login y yendo directo a la Agenda...");
        await page.goto("https://members.boxmagic.app/schedule", { waitUntil: 'networkidle' });
        await page.waitForTimeout(6000); 

        const content = await page.content();
        
        // Verificamos si logramos entrar buscando palabras clave de la agenda
        if (content.toLowerCase().includes('lunes') || content.toLowerCase().includes('horarios')) {
            log("✅ ¡LOGRADO! El bot ya está dentro de tu sesión.");
            
            // Lógica de detección rápida
            const bodyText = await page.innerText('body');
            log("🔎 Analizando cupos disponibles...");
            // (Aquí el bot ejecutará el aviso de Twilio si encuentra cupos)
            
        } else {
            log("❌ Error de acceso: El servidor rechazó el token. Verifica que sea el de hoy.");
        }
    } catch (e) {
        log(`❌ ERROR TÉCNICO: ${e.message}`);
    } finally {
        await browser.close();
        log("🏁 Proceso terminado.");
    }
}

run();