import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import twilio from 'twilio';

chromium.use(stealth());

const client = (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) ? twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN) : null;
const log = (msg) => console.log(`${new Date().toISOString()} | ${msg}`);

async function run() {
    log("🔍 MONITOR: Iniciando escaneo directo de cupos...");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    
    // Inyectamos tu identidad directamente para saltar el login fallido
    const context = await browser.newContext({
        extraHTTPHeaders: {
            'Authorization': `Bearer ${process.env.BOXMAGIC_TOKEN}`,
            'Gots-Gimnasio': 'oGDPQaGLb5',
            'Gots-App': 'members'
        },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    try {
        log("📅 Accediendo a la tabla de horarios...");
        const targetUrl = "https://members.boxmagic.app/a/g/oGDPQaGLb5/horarios";
        
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(10000); // Tiempo para que carguen los números de cupos

        const body = await page.innerText('body');
        
        if (body.includes('Nicolás') || body.includes('LUN')) {
            log("✅ Sensor conectado. Analizando texto...");

            // BUSCADOR DE CUPOS: Detecta cualquier número mayor a 0 al lado de la palabra cupo/libre/disponible
            const matches = body.match(/([1-9][0-9]?)\s*(cupos|libres|disponibles|vacantes)/i);

            if (matches) {
                const cantidad = matches[1];
                log(`🚨 ¡ÉXITO! Detectados ${cantidad} cupos disponibles.`);
                if (client) {
                    await client.messages.create({
                        body: `🚨 BoxMagic: ¡Hay ${cantidad} cupos libres! Entra ahora mismo.`,
                        from: process.env.TWILIO_FROM,
                        to: process.env.TWILIO_TO
                    });
                }
            } else {
                log("⏳ Monitor activo: No se detectan cupos disponibles en este momento.");
            }
        } else {
            log("❌ Error de acceso: El token ya no es válido o la URL cambió. Actualiza el Token.");
        }
    } catch (e) {
        log(`❌ Fallo en el ciclo: ${e.message}`);
    } finally {
        await browser.close();
        log("🏁 Ciclo terminado.");
    }
}

run();