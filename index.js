import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import twilio from 'twilio';

chromium.use(stealth());

const client = (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) ? twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN) : null;
const log = (msg) => console.log(`${new Date().toISOString()} | ${msg}`);

async function run() {
    log("🔍 INICIANDO MONITOR DE CUPOS (MODO CLONACIÓN)");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        extraHTTPHeaders: {
            'Authorization': `Bearer ${process.env.BOXMAGIC_TOKEN}`,
            'Gots-Gimnasio': 'oGDPQaGLb5',
            'Gots-App': 'members',
            'Gots-Ambiente': 'produccion',
            'Referer': 'https://members.boxmagic.app/',
            'Origin': 'https://members.boxmagic.app'
        }
    });

    const page = await context.newPage();

    try {
        log("📅 Accediendo directamente al sensor de la agenda...");
        const targetUrl = "https://members.boxmagic.app/a/g/oGDPQaGLb5/horarios";
        
        // Vamos directo a la URL de horarios saltando el login
        const response = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
        
        log(`📡 Respuesta del servidor: ${response.status()}`);
        await page.waitForTimeout(10000); // Tiempo para que el JS dibuje los cupos

        const body = await page.innerText('body');
        
        if (body.includes('Nicolás') || body.includes('LUN')) {
            log("✅ SENSOR CONECTADO: Leyendo disponibilidad...");

            // EXPRESIÓN REGULAR PARA DETECTAR CUPOS: Busca números seguidos de "cupos", "libres" o "espacios"
            const matches = body.match(/([1-9][0-9]?)\s*(cupos|libres|disponibles|espacios)/i);

            if (matches) {
                const cantidad = matches[1];
                log(`🚨 ALERTA: ¡Detección de ${cantidad} cupos!`);
                if (client) {
                    await client.messages.create({
                        body: `🚨 Monitor BoxMagic: ¡Hay ${cantidad} cupos disponibles! Reserva ya.`,
                        from: process.env.TWILIO_FROM,
                        to: process.env.TWILIO_TO
                    });
                }
            } else {
                log("⏳ Monitor activo: No se detectan cupos en este momento.");
            }
        } else {
            log("❌ ERROR DE SENSOR: No se detectó la estructura de la agenda. El token podría haber expirado.");
        }
    } catch (e) {
        log(`❌ FALLO OPERATIVO: ${e.message}`);
    } finally {
        await browser.close();
        log("🏁 Ciclo de monitorización finalizado.");
    }
}

run();