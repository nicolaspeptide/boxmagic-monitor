import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import twilio from 'twilio';

chromium.use(stealth());

const client = (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) ? twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN) : null;
const log = (msg) => console.log(`${new Date().toISOString()} | ${msg}`);

async function run() {
    log("🎯 OBJETIVO: DETECTAR CUPOS Y AVISAR POR TWILIO");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...' });
    const page = await context.newPage();

    try {
        log("🔑 Intentando entrada por Login Orgánico...");
        await page.goto("https://members.boxmagic.app/login", { waitUntil: 'networkidle' });
        
        // Espera flexible para el formulario
        const emailInput = page.locator('input[name="email"], input[type="email"]').first();
        try {
            await emailInput.waitFor({ timeout: 15000 });
            await emailInput.fill(process.env.USER_EMAIL);
            await page.fill('input[type="password"]', process.env.USER_PASS);
            await page.click('button[type="submit"]');
            await page.waitForNavigation({ waitUntil: 'networkidle' });
            log("✅ Login orgánico exitoso.");
        } catch (err) {
            log("⚠️ Login falló o tardó demasiado. Aplicando Token de Emergencia...");
            await page.setExtraHTTPHeaders({ 'Authorization': `Bearer ${process.env.BOXMAGIC_TOKEN}` });
        }

        log("📅 Navegando a la agenda para buscar cupos...");
        await page.goto("https://members.boxmagic.app/a/g/oGDPQaGLb5/horarios", { waitUntil: 'networkidle' });
        await page.waitForTimeout(10000); 

        const body = await page.innerText('body');
        
        // El corazón del objetivo: ¿Hay cupos?
        if (body.includes('Nicolás') || body.includes('LUN')) {
            const hayCupos = /([1-9])\s*(cupos|libres|disponibles)/i.test(body);
            if (hayCupos) {
                log("🚨 ¡CUPOS DETECTADOS!");
                if (client) {
                    await client.messages.create({
                        body: "🚨 BOXMAGIC: ¡Hay cupos disponibles! Entra ahora.",
                        from: process.env.TWILIO_FROM, to: process.env.TWILIO_TO
                    });
                }
            } else {
                log("⏳ Sin cupos aún.");
            }
        } else {
            log("❌ No se pudo validar la agenda. El acceso fue rechazado.");
        }
    } catch (e) {
        log(`❌ Error: ${e.message}`);
    } finally {
        await browser.close();
        log("🏁 Ciclo terminado.");
    }
}
run();