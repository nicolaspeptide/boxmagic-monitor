import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import twilio from 'twilio';

chromium.use(stealth());

const CONFIG = {
    email: process.env.BOXMAGIC_EMAIL,
    pass: process.env.BOXMAGIC_PASSWORD,
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
    log("🚀 Iniciando Motor de Diagnóstico Profundo...");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();

    try {
        log("🔑 Navegando a Boxmagic...");
        await page.goto("https://members.boxmagic.app/auth/login", { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(5000);

        // BUSQUEDA EN TODOS LOS MARCOS (IFRAMES)
        log("🔎 Buscando campos en todos los frames...");
        let loginFrame = page;
        const frames = page.frames();
        
        for (const frame of frames) {
            const hasEmail = await frame.locator('input[type="email"], input[name="email"]').count();
            if (hasEmail > 0) {
                log(`🎯 Formulario encontrado en frame: ${frame.name() || 'Principal'}`);
                loginFrame = frame;
                break;
            }
        }

        const userField = loginFrame.locator('input[type="email"], input[name="email"]').first();
        
        // Si no aparece, capturamos el error y el estado visual
        try {
            await userField.waitFor({ state: 'visible', timeout: 15000 });
        } catch (err) {
            log("❌ No se detectó el campo de email. Generando diagnóstico visual...");
            const screenshot = await page.screenshot({ fullPage: true });
            log(`📸 Captura (Base64): data:image/png;base64,${screenshot.toString('base64').substring(0, 100)}... (truncado)`);
            throw new Error("Campo de login no visible");
        }

        await userField.fill(CONFIG.email, { delay: 100 });
        await loginFrame.locator('input[type="password"]').first().fill(CONFIG.pass, { delay: 120 });
        
        await Promise.all([
            loginFrame.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {})
        ]);

        log("✅ Login procesado. Entrando a Agenda...");
        await page.goto("https://members.boxmagic.app/schedule", { waitUntil: 'networkidle' });
        
        // Espera dinámica por el contenido
        await page.waitForSelector('text=/Lunes|Monday|Martes|Tuesday/i', { timeout: 20000 });

        // ... (resto de la lógica de rastreo de clases igual que la anterior)
        log("🔎 Escaneando clases...");
        
    } catch (e) {
        log(`❌ ERROR FINAL: ${e.message}`);
    } finally {
        await browser.close();
        log("🧹 Fin del proceso.");
    }
}

run();