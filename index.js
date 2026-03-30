import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

const CONFIG = {
    email: process.env.USER_EMAIL,
    pass: process.env.USER_PASS,
    token: process.env.BOXMAGIC_TOKEN, // Opcional: para el intento rápido
    agendaUrl: "https://members.boxmagic.app/a/g/oGDPQaGLb5/horarios"
};

const log = (msg) => console.log(`${new Date().toISOString()} | ${msg}`);

async function run() {
    log("🛡️ INICIANDO MOTOR HÍBRIDO RESILIENTE");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        // PASO 1: INTENTO DE LOGIN ORGÁNICO (La base más sólida)
        log("🔑 Iniciando flujo de autenticación...");
        await page.goto("https://members.boxmagic.app/login", { waitUntil: 'networkidle' });
        
        await page.fill('input[type="email"]', CONFIG.email);
        await page.fill('input[type="password"]', CONFIG.pass);
        await page.click('button[type="submit"]');
        
        // Esperamos validación de entrada
        await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
        log("✅ Sesión validada por el servidor.");

        // PASO 2: NAVEGACIÓN A LA RUTA CRÍTICA
        log("📅 Accediendo a la agenda de cupos...");
        const response = await page.goto(CONFIG.agendaUrl, { waitUntil: 'networkidle' });
        
        if (response.status() === 404) {
            throw new Error("El servidor devolvió 404 en la ruta de la agenda. Revisa el ID del gimnasio.");
        }

        await page.waitForTimeout(10000); // Espera crucial para renderizado de clases

        const body = await page.innerText('body');
        
        if (body.includes('Nicolás') || body.includes('LUN')) {
            log("🎯 EXITO TOTAL: Bot dentro de la agenda.");
            // Aquí pones tu lógica de Twilio y escaneo...
        } else {
            log("⚠️ El bot entró pero la página parece vacía. Tomando captura...");
            await page.screenshot({ path: 'diagnostico.png' });
        }

    } catch (e) {
        log(`❌ FALLO ESTRATÉGICO: ${e.message}`);
    } finally {
        await browser.close();
        log("🏁 Ciclo finalizado.");
    }
}

run();