import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import twilio from 'twilio';

chromium.use(stealth());

// Configuración de Twilio (El objetivo: avisarte)
const twilioClient = (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) 
    ? twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN) : null;

const log = (msg) => console.log(`${new Date().toISOString()} | ${msg}`);

async function run() {
    log("🛡️ INICIANDO SOLUCIÓN RESILIENTE - OBJETIVO: DETECTAR CUPOS");
    
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        // PASO 1: LOGIN ORGÁNICO
        log("🔑 Paso 1: Logueando en BoxMagic...");
        await page.goto("https://members.boxmagic.app/login", { waitUntil: 'networkidle' });
        await page.fill('input[type="email"]', process.env.USER_EMAIL);
        await page.fill('input[type="password"]', process.env.USER_PASS);
        await page.click('button[type="submit"]');
        
        await page.waitForNavigation({ waitUntil: 'networkidle' });
        log("✅ Login exitoso.");

        // PASO 2: NAVEGACIÓN A LA AGENDA
        log("📅 Paso 2: Accediendo a la agenda del gimnasio...");
        // Usamos la URL específica que confirmamos en tus capturas
        await page.goto("https://members.boxmagic.app/a/g/oGDPQaGLb5/horarios", { waitUntil: 'networkidle' });
        await page.waitForTimeout(10000); // Tiempo para que carguen los cupos dinámicos

        // PASO 3: EL OBJETIVO (DETECCIÓN Y AVISO)
        const bodyText = await page.innerText('body');
        
        // Buscamos indicadores de éxito de entrada y presencia de cupos
        if (bodyText.includes('Nicolás') || bodyText.includes('Sesiones')) {
            log("🎯 Dentro de la agenda. Analizando disponibilidad...");

            // Lógica de detección: si el texto contiene números seguidos de 'cupos' o 'libres'
            const hayCupos = /([1-9]|[1-9][0-9])\s*(cupos|libres|disponibles)/i.test(bodyText);

            if (hayCupos) {
                log("🚨 ¡CUPOS DETECTADOS! Enviando Twilio...");
                if (twilioClient) {
                    await twilioClient.messages.create({
                        body: "🚨 ¡BOXMAGIC ACTUALIZADO! Se detectaron cupos libres. Entra ahora para reservar.",
                        from: process.env.TWILIO_FROM,
                        to: process.env.TWILIO_TO
                    });
                    log("📲 Twilio enviado con éxito.");
                }
            } else {
                log("⏳ No se detectaron cupos libres en este ciclo.");
            }
        } else {
            log("❌ Error: No se pudo verificar la agenda. Revisando URL final...");
            log(`📍 URL Actual: ${page.url()}`);
        }

    } catch (e) {
        log(`❌ FALLO TÉCNICO: ${e.message}`);
    } finally {
        await browser.close();
        log("🏁 Ciclo finalizado.");
    }
}

run();