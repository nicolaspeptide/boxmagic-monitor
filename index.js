import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import twilio from 'twilio';

chromium.use(stealth());

const client = (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) ? twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN) : null;

async function run() {
    console.log("🚀 INICIANDO ESTRATEGIA DE ACCESO TOTAL...");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36' });
    const page = await context.newPage();

    try {
        // 1. LOGIN MANUAL (Evita el bloqueo de tokens)
        console.log("🔑 Accediendo al login...");
        await page.goto("https://members.boxmagic.app/login", { waitUntil: 'networkidle' });
        await page.fill('input[type="email"]', process.env.USER_EMAIL);
        await page.fill('input[type="password"]', process.env.USER_PASS);
        await page.click('button[type="submit"]');
        
        // Esperar a que el dashboard cargue
        await page.waitForNavigation({ waitUntil: 'networkidle' });
        console.log("✅ Login exitoso.");

        // 2. NAVEGACIÓN A LA AGENDA ESPECÍFICA
        console.log("📅 Navegando a la agenda de tu gimnasio...");
        await page.goto("https://members.boxmagic.app/a/g/oGDPQaGLb5/horarios", { waitUntil: 'networkidle' });
        await page.waitForTimeout(10000); // Espera crucial para que carguen las clases

        // 3. VERIFICACIÓN DE CONTENIDO
        const content = await page.innerText('body');
        if (content.includes('Nicolás') || content.includes('LUN')) {
            console.log("🎯 ¡DENTRO! Agenda detectada correctamente.");
            
            // 4. LÓGICA DE ESCANEO DE CUPOS
            if (content.includes('cupos') || content.includes('disponibles')) {
                console.log("🚨 ¡CUPOS DETECTADOS!");
                if (client) {
                    await client.messages.create({
                        body: "🚨 Boxmagic: ¡Hay cupos disponibles ahora! Entra ya.",
                        from: process.env.TWILIO_FROM,
                        to: process.env.TWILIO_TO
                    });
                }
            }
        } else {
            console.log("⚠️ No se reconoció la agenda. Tomando captura de diagnóstico...");
            await page.screenshot({ path: 'estado.png' });
        }
    } catch (e) {
        console.log(`❌ ERROR CRÍTICO: ${e.message}`);
    } finally {
        await browser.close();
        console.log("🏁 Proceso finalizado.");
    }
}

run();