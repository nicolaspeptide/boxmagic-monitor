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
    log("🚀 Iniciando motor con Espera de Renderizado...");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();

    try {
        log("🔐 Login...");
        await page.goto(CONFIG.url, { waitUntil: 'networkidle' });
        await page.fill('input[type="email"]', CONFIG.email);
        await page.fill('input[type="password"]', CONFIG.pass);
        await page.click('button[type="submit"]');
        
        // Esperamos a que el login nos saque de la página de auth
        await page.waitForTimeout(5000);

        log("📅 Navegando a Agenda y esperando renderizado...");
        await page.goto("https://members.boxmagic.app/a/g/oGDPQaGLb5/schedule", { waitUntil: 'networkidle' });
        
        // CRÍTICO: Esperamos a que aparezca CUALQUIER indicio de calendario o clases
        // Esto detiene el script hasta que la página realmente cargue el contenido
        await page.waitForSelector('button, .day-selector, .calendar, [class*="day"]', { timeout: 15000 }).catch(() => log("⚠️ Timeout esperando selectores, intentando continuar..."));
        await page.waitForTimeout(3000); // Respiro final para animaciones

        const dayKeywords = {
            monday: [/lunes/i, /monday/i, /lun/i, /mon/i],
            tuesday: [/martes/i, /tuesday/i, /mar/i, /tue/i],
            wednesday: [/miércoles/i, /miercoles/i, /wednesday/i, /mie/i, /wed/i],
            friday: [/viernes/i, /friday/i, /vie/i, /fri/i]
        };

        for (const [day, targetHours] of Object.entries(CONFIG.schedules)) {
            log(`🔎 Buscando día: ${day}...`);
            
            // Buscador por texto exacto o contenido en botones/enlaces
            const dayButton = page.locator('button, a, span, div').filter({ hasText: dayKeywords[day][0] }).first();

            if (await dayButton.count() > 0) {
                log(`🖱️ Click en ${day}`);
                await dayButton.click({ force: true });
                await page.waitForTimeout(3000); // Espera a que cambie la lista de clases
            } else {
                log(`⚠️ No se encontró el día ${day}.`);
                continue;
            }

            // Seleccionamos las clases del día
            const cards = await page.locator('div[class*="card"], article, .session-item, div:has-text(":")').all();
            
            for (const card of cards) {
                const text = (await card.innerText()).toLowerCase().replace(/\s+/g, ' ');
                if (text.length > 500 || text.length < 10) continue;

                const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
                if (!timeMatch) continue;
                
                let hour = parseInt(timeMatch[1]);
                if ((text.includes("pm") || text.includes("noche")) && hour < 12) hour += 12;

                if (targetHours.includes(hour)) {
                    log(`⏰ Revisando ${day} @ ${hour}:00`);
                    
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