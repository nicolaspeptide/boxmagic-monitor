import { chromium } from 'playwright';
import twilio from 'twilio';

const CONFIG = {
    url: process.env.BOXMAGIC_ENTRY_URL || "https://members.boxmagic.app/",
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
    log("🚀 Iniciando Motor de Auto-Detección...");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();

    try {
        log("🔐 Login en Home...");
        await page.goto("https://members.boxmagic.app/auth/login", { waitUntil: 'networkidle' });
        await page.fill('input[type="email"]', CONFIG.email);
        await page.fill('input[type="password"]', CONFIG.pass);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(8000);

        log("🔎 Buscando enlace real a la Agenda...");
        // Buscamos cualquier link que lleve a la agenda (Schedule)
        const scheduleLink = page.locator('a[href*="schedule"], a:has-text("Agenda"), a:has-text("Horarios")').first();
        
        if (await scheduleLink.count() > 0) {
            const realUrl = await scheduleLink.getAttribute('href');
            log(`🔗 URL real detectada: ${realUrl}`);
            await scheduleLink.click();
        } else {
            log("⚠️ No hallé link, intentando ruta base...");
            await page.goto("https://members.boxmagic.app/schedule", { waitUntil: 'networkidle' });
        }
        
        await page.waitForTimeout(6000);
        const currentUrl = page.url();
        log(`📍 Ubicación actual: ${currentUrl}`);

        const dayKeywords = {
            monday: [/lunes/i, /monday/i, /lun/i, /mon/i],
            tuesday: [/martes/i, /tuesday/i, /mar/i, /tue/i],
            wednesday: [/miércoles/i, /miercoles/i, /wednesday/i, /mie/i, /wed/i],
            friday: [/viernes/i, /friday/i, /vie/i, /fri/i]
        };

        for (const [day, targetHours] of Object.entries(CONFIG.schedules)) {
            log(`🔎 Revisando ${day}...`);
            
            // Selector por texto flexible
            const dayButton = page.locator('button, a, span, div').filter({ hasText: dayKeywords[day][0] }).first();

            if (await dayButton.count() > 0) {
                await dayButton.click({ force: true });
                await page.waitForTimeout(4000);
            } else {
                log(`❌ ${day} no visible.`);
                continue;
            }

            // Captura de clases (buscamos cualquier div con formato de hora)
            const cards = await page.locator('div, article, section, li').filter({ hasText: /\d{1,2}:\d{2}/ }).all();
            
            for (const card of cards) {
                const text = (await card.innerText()).toLowerCase().replace(/\s+/g, ' ');
                if (text.length > 600 || text.length < 10) continue;

                const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
                if (!timeMatch) continue;
                
                let hour = parseInt(timeMatch[1]);
                if ((text.includes("pm") || text.includes("noche")) && hour < 12) hour += 12;

                if (targetHours.includes(hour)) {
                    log(`⏰ Clase encontrada @ ${hour}:00`);
                    
                    const isBooked = /reservado|inscrito|mi cupo|cancelar|booked/.test(text);
                    if (isBooked) {
                        log(`✅ ${day} @ ${hour}:00 -> YA RESERVADO.`);
                        break; 
                    }

                    const dispoMatch = text.match(/(\d+)\s*(cupos|disponibles|espacios|slots)/);
                    if (dispoMatch && !/completa|full|0 cupos/.test(text)) {
                        const spots = parseInt(dispoMatch[1]);
                        if (spots > 0) {
                            const msg = `🚨 ¡CUPOS!\n📅 ${day}\n🕒 ${hour}:00\n👥 ${spots} libres.`;
                            log("📣 WHATSAPP ENVIADO");
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