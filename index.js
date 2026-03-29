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
    log("🚀 Iniciando rastreador con Localizador Universal...");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();

    try {
        log("🔐 Login en proceso...");
        await page.goto(CONFIG.url, { waitUntil: 'networkidle' });
        await page.fill('input[type="email"]', CONFIG.email);
        await page.fill('input[type="password"]', CONFIG.pass);
        await page.click('button[type="submit"], button:has-text("Entrar")');
        await page.waitForTimeout(5000);

        log("📅 Navegando a Agenda...");
        await page.goto("https://members.boxmagic.app/a/g/oGDPQaGLb5/schedule", { waitUntil: 'networkidle' });
        await page.waitForTimeout(4000);

        const dayKeywords = {
            monday: ["lunes", "monday", "lun", "mon"],
            tuesday: ["martes", "tuesday", "mar", "tue"],
            wednesday: ["miércoles", "miercoles", "wednesday", "mie", "wed"],
            friday: ["viernes", "friday", "vie", "fri"]
        };

        for (const [day, targetHours] of Object.entries(CONFIG.schedules)) {
            log(`🔎 Buscando día: ${day}...`);
            
            // BUSCADOR UNIVERSAL: Busca cualquier elemento cliqueable que contenga el texto del día
            const dayButton = page.locator('button, a, div, span, p').filter({ 
                hasText: new RegExp(`^(${dayKeywords[day].join('|')})$`, 'i') 
            }).first();

            if (await dayButton.count() > 0) {
                log(`🖱️ Click detectado para ${day}`);
                await dayButton.click({ force: true });
                await page.waitForTimeout(3000);
            } else {
                // Intento 2: Buscar por texto parcial si el exacto falla
                const partialButton = page.getByText(new RegExp(dayKeywords[day][0], 'i')).first();
                if (await partialButton.count() > 0) {
                    log(`🖱️ Click parcial para ${day}`);
                    await partialButton.click({ force: true });
                    await page.waitForTimeout(3000);
                } else {
                    log(`⚠️ No se encontró rastro de ${day} en el DOM.`);
                    continue;
                }
            }

            // Captura de clases con selector ultra-amplio
            const cards = await page.locator('div, article, section').filter({ hasText: /\d{1,2}:\d{2}/ }).all();
            log(`📦 Elementos con hora encontrados en ${day}: ${cards.length}`);

            for (const card of cards) {
                const text = (await card.innerText()).toLowerCase().replace(/\s+/g, ' ');
                if (text.length > 500) continue; // Evitar capturar todo el body

                const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
                if (!timeMatch) continue;
                
                let hour = parseInt(timeMatch[1]);
                if (text.includes("pm") && hour < 12) hour += 12;

                if (targetHours.includes(hour)) {
                    log(`⏰ Analizando bloque ${hour}:00`);
                    
                    const isBooked = /reservado|inscrito|mi cupo|cancelar|booked|mis clases/.test(text);
                    if (isBooked) {
                        log(`✅ ${day} @ ${hour}:00 -> YA RESERVADO.`);
                        break; 
                    }

                    const dispoMatch = text.match(/(\d+)\s*(cupos|disponibles|espacios|slots|available)/);
                    if (dispoMatch && !/completa|full|0 cupos/.test(text)) {
                        const spots = parseInt(dispoMatch[1]);
                        if (spots > 0) {
                            const msg = `🚨 ¡CUPOS EN ORIGEN!\n📅 ${day}\n🕒 ${hour}:00\n👥 ${spots} libres.`;
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