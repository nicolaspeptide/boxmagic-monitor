import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import twilio from 'twilio';

// Activamos el modo sigilo para evitar bloqueos
chromium.use(stealth());

const CONFIG = {
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
    log("🚀 Iniciando Motor Ultra-Stealth...");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();

    try {
        log("🔑 Entrando a Boxmagic...");
        await page.goto("https://members.boxmagic.app/auth/login", { waitUntil: 'networkidle', timeout: 60000 });

        const userField = page.locator('input[type="email"], input[name="email"]').first();
        await userField.waitFor({ state: 'visible', timeout: 20000 });
        
        log("⌨️ Rellenando credenciales...");
        await userField.fill(CONFIG.email, { delay: 100 });
        await page.fill('input[type="password"]', CONFIG.pass, { delay: 120 });
        
        await Promise.all([
            page.click('button[type="submit"]'),
            page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => log("⚠️ Navegación lenta..."))
        ]);

        log("✅ Login OK. Navegando a Agenda...");
        await page.goto("https://members.boxmagic.app/schedule", { waitUntil: 'networkidle' });
        
        // Esperamos a que el calendario cargue visualmente
        await page.waitForSelector('text=/Lunes|Monday/i', { timeout: 20000 });

        const dayKeywords = {
            monday: [/lunes/i, /monday/i],
            tuesday: [/martes/i, /tuesday/i],
            wednesday: [/miércoles/i, /miercoles/i, /wednesday/i],
            friday: [/viernes/i, /friday/i]
        };

        for (const [day, targetHours] of Object.entries(CONFIG.schedules)) {
            log(`🔎 Revisando: ${day}...`);
            const dayBtn = page.getByText(dayKeywords[day][0]).first();

            if (await dayBtn.count() > 0) {
                await dayBtn.click({ force: true });
                await page.waitForTimeout(4000); 
                
                const classes = await page.locator('div, li, article').filter({ hasText: /\d{1,2}:\d{2}/ }).all();
                
                for (const item of classes) {
                    const text = (await item.innerText()).toLowerCase();
                    const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
                    if (!timeMatch) continue;

                    let hour = parseInt(timeMatch[1]);
                    if ((text.includes("pm") || text.includes("noche")) && hour < 12) hour += 12;

                    if (targetHours.includes(hour)) {
                        log(`⏰ Clase detectada @ ${hour}:00`);
                        if (/reservado|inscrito|mi cupo/.test(text)) {
                            log(`✅ Ya estás inscrito.`);
                            break;
                        }

                        const spots = text.match(/(\d+)\s*(cupos|disponibles|espacios)/);
                        if (spots && parseInt(spots[1]) > 0) {
                            const msg = `🚨 ¡HAY CUPOS!\n📅 ${day}\n🕒 ${hour}:00\n👥 ${spots[1]} libres.`;
                            log("📣 ENVIANDO WHATSAPP...");
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
        log("🧹 Fin del proceso.");
    }
}

run();