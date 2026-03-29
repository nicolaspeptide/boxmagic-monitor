import { chromium } from 'playwright';
import twilio from 'twilio';

const CONFIG = {
    url: process.env.BOXMAGIC_ENTRY_URL || "https://members.boxmagic.app/a/g/oGDPQaGLb5/perfil?o=a-iugpd",
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
    log("🚀 Iniciando Motor de Diagnóstico...");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();

    try {
        log("🔑 Entrando...");
        await page.goto(CONFIG.url, { waitUntil: 'networkidle' });
        await page.fill('input[type="email"]', CONFIG.email);
        await page.fill('input[type="password"]', CONFIG.pass);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(6000);

        log("📅 Navegando a Agenda...");
        await page.goto("https://members.boxmagic.app/a/g/oGDPQaGLb5/schedule", { waitUntil: 'networkidle' });
        await page.waitForTimeout(5000);

        // DEBUG: Imprimir qué texto hay en la página para ver si estamos en el sitio correcto
        const bodyText = await page.innerText('body');
        log(`📄 Contenido detectado (primeros 150 caracteres): ${bodyText.substring(0, 150).replace(/\n/g, ' ')}`);

        const dayKeywords = {
            monday: [/lunes/i, /monday/i, /lun/i, /mon/i],
            tuesday: [/martes/i, /tuesday/i, /mar/i, /tue/i],
            wednesday: [/miércoles/i, /miercoles/i, /wednesday/i, /mie/i, /wed/i],
            friday: [/viernes/i, /friday/i, /vie/i, /fri/i]
        };

        for (const [day, targetHours] of Object.entries(CONFIG.schedules)) {
            log(`🔎 Buscando día: ${day}...`);
            
            // Selector "Omnidireccional": Busca el texto del día en cualquier etiqueta
            const dayButton = page.locator('button, a, span, div, li, p').filter({ hasText: dayKeywords[day][0] }).first();

            if (await dayButton.count() > 0 && await dayButton.isVisible()) {
                log(`🖱️ Click en ${day}`);
                await dayButton.click({ force: true });
                await page.waitForTimeout(3000);
            } else {
                log(`⚠️ ${day} no encontrado. Intentando selector de respaldo...`);
                // Respaldo: buscar por texto simple en la página
                const backup = page.getByText(dayKeywords[day][0]).first();
                if (await backup.count() > 0) {
                    await backup.click({ force: true });
                    log(`🖱️ Click de respaldo en ${day}`);
                    await page.waitForTimeout(3000);
                } else {
                    continue;
                }
            }

            // Detección de clases por patrones de tiempo (XX:XX)
            const cards = await page.locator('div, article, section, li').filter({ hasText: /\d{1,2}:\d{2}/ }).all();
            
            for (const card of cards) {
                const text = (await card.innerText()).toLowerCase().replace(/\s+/g, ' ');
                if (text.length > 600 || text.length < 12) continue;

                const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
                if (!timeMatch) continue;
                
                let hour = parseInt(timeMatch[1]);
                if ((text.includes("pm") || text.includes("noche")) && hour < 12) hour += 12;

                if (targetHours.includes(hour)) {
                    log(`⏰ Evaluando ${day} @ ${hour}:00`);
                    
                    const isBooked = /reservado|inscrito|mi cupo|cancelar|booked|inscrito/.test(text);
                    if (isBooked) {
                        log(`✅ ${day} @ ${hour}:00 -> YA RESERVADO.`);
                        break; 
                    }

                    const dispoMatch = text.match(/(\d+)\s*(cupos|disponibles|espacios|slots|vacantes)/);
                    if (dispoMatch && !/completa|full|0 cupos|agotado/.test(text)) {
                        const spots = parseInt(dispoMatch[1]);
                        if (spots > 0) {
                            const msg = `🚨 ¡CUPOS!\n📅 ${day}\n🕒 ${hour}:00\n👥 ${spots} disponibles.`;
                            log("📣 ALERTA ENVIADA");
                            if (client) await client.messages.create({ body: msg, from: process.env.TWILIO_FROM, to: process.env.TWILIO_TO });
                            break;
                        }
                    }
                }
            }
        }
    } catch (e) {
        log(`❌ ERROR: ${e.message}`);
    } finally {
        await browser.close();
        log("🧹 Monitor finalizado.");
    }
}

run();