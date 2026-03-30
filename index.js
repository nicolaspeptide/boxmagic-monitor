import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import twilio from 'twilio';

chromium.use(stealth());

const client = (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) ? twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN) : null;
const log = (msg) => console.log(`${new Date().toISOString()} | ${msg}`);

async function run() {
    log("🔍 INICIANDO MONITOR DE CUPOS - ENFOQUE EN DETECCIÓN");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        // 1. LOGIN CON REINTENTO AUTOMÁTICO
        log("🔑 Accediendo para validar sesión...");
        await page.goto("https://members.boxmagic.app/login", { waitUntil: 'networkidle' });
        
        await page.waitForSelector('input[type="email"]', { visible: true, timeout: 20000 });
        await page.type('input[type="email"]', process.env.USER_EMAIL, { delay: 50 });
        await page.type('input[type="password"]', process.env.USER_PASS, { delay: 50 });
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle' })
        ]);

        // 2. NAVEGACIÓN Y ESPERA SELECTIVA (El corazón del monitor)
        log("📅 Navegando a la agenda de horarios...");
        await page.goto("https://members.boxmagic.app/a/g/oGDPQaGLb5/horarios", { waitUntil: 'networkidle' });
        
        // Esperamos específicamente a que aparezcan las tarjetas de clase (el elemento que contiene los cupos)
        log("⏳ Esperando renderizado de clases...");
        await page.waitForSelector('.card-content, .session-item, button', { timeout: 20000 });
        await page.waitForTimeout(5000); // Estabilización final

        // 3. LÓGICA DE DETECCIÓN PURA
        const bodyText = await page.innerText('body');
        
        if (bodyText.includes('Nicolás') || bodyText.includes('LUN')) {
            log("✅ Conexión con agenda establecida.");

            // Buscamos patrones de disponibilidad: ej. "5 cupos", "1 disponible", "Espacios disponibles"
            const matches = bodyText.match(/([1-9][0-9]?)\s*(cupos|libres|disponibles|espacios)/i);

            if (matches) {
                const cantidad = matches[1];
                log(`🚨 DETECCIÓN POSITIVA: Se encontraron ${cantidad} cupos.`);
                if (client) {
                    await client.messages.create({
                        body: `🚨 Monitor BoxMagic: Se han detectado ${cantidad} cupos disponibles. Reserva ahora.`,
                        from: process.env.TWILIO_FROM,
                        to: process.env.TWILIO_TO
                    });
                }
            } else {
                log("ℹ️ Monitor activo: No se detectan cupos disponibles en este momento.");
            }
        } else {
            log("❌ Error de monitor: Se accedió a la URL pero no se detectó la estructura de la agenda.");
        }

    } catch (e) {
        log(`❌ FALLO OPERATIVO: ${e.message}`);
    } finally {
        await browser.close();
        log("🏁 Ciclo de monitorización finalizado.");
    }
}

run();