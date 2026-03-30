import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import twilio from 'twilio';

chromium.use(stealth());

const client = (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) ? twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN) : null;
const log = (msg) => console.log(`${new Date().toISOString()} | ${msg}`);

async function run() {
    log("🚀 MOTOR DE ACCESO FINAL - OBJETIVO: CUPOS");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        log("🔑 Paso 1: Navegando al Login...");
        await page.goto("https://members.boxmagic.app/login", { waitUntil: 'commit', timeout: 60000 });
        
        // Espera a que el selector sea visible de verdad (máxima tolerancia)
        log("⏳ Esperando que el formulario sea interactuable...");
        await page.waitForSelector('input[type="email"]', { state: 'visible', timeout: 30000 });
        
        log("✍️ Escribiendo credenciales...");
        await page.type('input[type="email"]', process.env.USER_EMAIL, { delay: 100 });
        await page.type('input[type="password"]', process.env.USER_PASS, { delay: 100 });
        
        log("🖱️ Haciendo clic en Entrar...");
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle', timeout: 45000 })
        ]);

        log("✅ Sesión Iniciada. Saltando a la Agenda...");
        await page.goto("https://members.boxmagic.app/a/g/oGDPQaGLb5/horarios", { waitUntil: 'networkidle' });
        
        // Espera de seguridad para que el calendario se pinte
        await page.waitForTimeout(12000); 

        const content = await page.innerText('body');
        
        if (content.includes('Nicolás') || content.includes('LUN')) {
            log("🎯 DENTRO. Analizando cupos para el objetivo...");
            
            // Lógica de detección de cupos mejorada
            const hayCupos = content.match(/([1-9])\s*(cupos|libres|disponibles)/i);

            if (hayCupos) {
                log(`🚨 ¡CUPOS DETECTADOS: ${hayCupos[1]}! Enviando Twilio...`);
                if (client) {
                    await client.messages.create({
                        body: `🚨 BOXMAGIC: ¡Hay ${hayCupos[1]} cupos disponibles ahora! Entra ya.`,
                        from: process.env.TWILIO_FROM, 
                        to: process.env.TWILIO_TO
                    });
                    log("📲 Twilio enviado.");
                }
            } else {
                log("⏳ Sin cupos detectados en este ciclo.");
            }
        } else {
            log("❌ No se reconoce el contenido de la agenda.");
        }

    } catch (e) {
        log(`❌ FALLO CRÍTICO: ${e.message}`);
        // Captura de pantalla para ver por qué falló el selector
        await page.screenshot({ path: 'fallo_login.png' });
    } finally {
        await browser.close();
        log("🏁 Proceso finalizado.");
    }
}

run();