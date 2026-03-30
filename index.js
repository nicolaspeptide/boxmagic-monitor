import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

async function run() {
    console.log("🛠️ Iniciando navegación completa (Modo Humano)...");
    
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        // 1. Ir al login
        await page.goto("https://members.boxmagic.app/login", { waitUntil: 'networkidle' });
        
        // 2. Intentar loguear solo si detecta los campos
        if (await page.isVisible('input[type="email"]')) {
            console.log("🔑 Pantalla de login detectada. Ingresando credenciales...");
            await page.fill('input[type="email"]', process.env.USER_EMAIL);
            await page.fill('input[type="password"]', process.env.USER_PASS);
            await page.click('button[type="submit"]');
            await page.waitForNavigation({ waitUntil: 'networkidle' });
        }

        // 3. Ir a la agenda
        await page.goto("https://members.boxmagic.app/a/g/oGDPQaGLb5/horarios");
        await page.waitForTimeout(10000); // Espera larga para que cargue todo

        const content = await page.content();
        if (content.includes('Nicolás') || content.includes('Sesiones')) {
            console.log("✅ Acceso exitoso a la agenda.");
            // Lógica de Twilio aquí...
        } else {
            console.log("❌ No se pudo validar la sesión. Tomando captura para ver qué pasó...");
            await page.screenshot({ path: 'error.png' });
        }
    } catch (e) {
        console.log(`❌ Error: ${e.message}`);
    } finally {
        await browser.close();
    }
}
run();