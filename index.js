import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import twilio from 'twilio';

chromium.use(stealth());

const CONFIG = {
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
    log("🚀 ESTRATEGIA FINAL: Inyección Directa de Sesión");
    
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    // Aquí ocurre la magia: el bot se presenta con tu token ante Boxmagic
    const context = await browser.newContext({
        extraHTTPHeaders: {
            'Authorization': `Bearer ${CONFIG.authToken.trim()}`
        }
    });

    const page = await context.newPage();

    try {
        log("📅 Saltando login y yendo directo a Horarios...");
        await page.goto("https://members.boxmagic.app/schedule", { waitUntil: 'networkidle' });
        await page.waitForTimeout(5000); // Espera de seguridad para carga de JS

        const bodyText = await page.innerText('body');
        
        if (bodyText.toLowerCase().includes('lunes') || bodyText.toLowerCase().includes('horarios')) {
            log("✅ LOGRADO: Estamos dentro de la agenda.");
            
            // ESCANEO DE CUPOS
            for (const [day, hours] of Object.entries(CONFIG.schedules)) {
                // Buscamos el botón del día por texto (ej: "LUN 30")
                const dayBtn = page.locator('button, div, span').filter({ hasText: new RegExp(day, 'i') }).first();
                if (await dayBtn.count() > 0) {
                    await dayBtn.click({ force: true });
                    await page.waitForTimeout(2000);
                    
                    const content = await page.innerText('body');
                    // Si encuentra la hora y dice que hay cupos (ej: "5 cupos")
                    if (hours.some(h => content.includes(`${h}:00`)) && /cupos|libres|disponibles/.test(content)) {
                        log(`🚨 ¡CUPOS ENCONTRADOS PARA ${day.toUpperCase()}!`);
                        if (client) await client.messages.create({ 
                            body: `🚨 Boxmagic: Cupos libres para el ${day} a las ${hours.join(':00, ')}:00`, 
                            from: process.env.TWILIO_FROM, 
                            to: process.env.TWILIO_TO 
                        });
                    }
                }
            }
        } else {
            log("❌ Error: El token no funcionó o expiró. Verifica el valor en Railway.");
        }
    } catch (e) {
        log(`❌ ERROR: ${e.message}`);
    } finally {
        await browser.close();
        log("🏁 Proceso terminado.");
    }
}

run();