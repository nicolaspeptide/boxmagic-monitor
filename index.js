import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import twilio from 'twilio';

chromium.use(stealth());

const client = (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) ? twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN) : null;
const log = (msg) => console.log(`${new Date().toISOString()} | ${msg}`);

async function run() {
    log("🚀 ESTRATEGIA MAESTRA: Navegación Orgánica Completa");
    
    // Lanzamos navegador con huella de usuario real
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        // PASO 1: Login Real
        log("🔑 Iniciando sesión desde la puerta principal...");
        await page.goto("https://members.boxmagic.app/login", { waitUntil: 'networkidle' });
        
        await page.fill('input[type="email"]', process.env.USER_EMAIL);
        await page.fill('input[type="password"]', process.env.USER_PASS);
        await page.click('button[type="submit"]');
        
        // Esperamos que el servidor nos reconozca y nos mueva
        await page.waitForNavigation({ waitUntil: 'networkidle' });
        log("✅ Sesión iniciada correctamente.");

        // PASO 2: Navegación a la Agenda del Gimnasio
        log("📅 Navegando a la agenda de tu gimnasio...");
        await page.goto("https://members.boxmagic.app/a/g/oGDPQaGLb5/horarios", { waitUntil: 'networkidle' });
        
        // Espera de seguridad para carga de componentes dinámicos
        await page.waitForTimeout(10000); 

        const content = await page.innerText('body');
        
        if (content.includes('Nicolás') || content.includes('LUN')) {
            log("🎯 ¡CONSEGUIDO! Agenda visible y operativa.");
            
            // PASO 3: Lógica de detección de cupos
            if (/cupos|libres|disponibles/i.test(content)) {
                log("🚨 ¡HAY CUPOS DETECTADOS!");
                if (client) {
                    await client.messages.create({
                        body: "🚨 Boxmagic: ¡Hay cupos disponibles ahora! Entra a la App.",
                        from: process.env.TWILIO_FROM,
                        to: process.env.TWILIO_TO
                    });
                }
            }
        } else {
            log("⚠️ Acceso logrado pero no se detectó el contenido esperado.");
        }

    } catch (e) {
        log(`❌ FALLO TÉCNICO: ${e.message}`);
    } finally {
        await browser.close();
        log("🏁 Ciclo completado.");
    }
}

run();