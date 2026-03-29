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

const client = (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) 
    ? twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN) 
    : null;

const log = (msg) => console.log(`${new Date().toISOString()} | ${msg}`);

async function run() {
    log("🚀 Iniciando motor senior...");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();

    try {
        await page.goto(CONFIG.url, { waitUntil: 'networkidle' });
        
        // Login robusto
        await page.fill('input[type="email"]', CONFIG.email);
        await page.fill('input[type="password"]', CONFIG.pass);
        await Promise.all([
            page.click('button[type="submit"], button:has-text("Entrar")'),
            page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {})
        ]);

        // Navegación directa a la agenda
        await page.goto("https://members.boxmagic.app/a/g/oGDPQaGLb5/schedule", { waitUntil: 'networkidle' });

        for (const [day, targetHours] of Object.entries(CONFIG.schedules)) {
            log(`Evaluando ${day}...`);
            
            const dayTab = page.locator(`button, span, a`).filter({ hasText: new RegExp(`^${day}$`, 'i') }).first();
            if (await dayTab.count() > 0) {
                await dayTab.click();
                await page.waitForTimeout(2000);
            }

            let diaResuelto = false;
            // Selector de tarjeta más genérico pero efectivo
            const cards = await page.locator('div[class*="card"], .session-item, [role="listitem"]').all();

            for (const card of cards) {
                const text = (await card.innerText()).toLowerCase();
                const timeMatch = text.match(/(\d{2}):(\d{2})/);
                if (!timeMatch) continue;
                
                const hour = parseInt(timeMatch[1]);
                if (targetHours.includes(hour)) {
                    
                    // Lógica de descarte inmediata
                    if (text.includes("reservado") || text.includes("inscrito") || text.includes("mi cupo")) {
                        log(`✅ ${day} @ ${hour}:00 - Ya tienes reserva. Saltando día.`);
                        diaResuelto = true;
                        break;
                    }

                    // Disponibilidad real: Solo si hay un número positivo de cupos
                    const dispoMatch = text.match(/(\d+)\s*(cupos|disponibles|espacios|slots|available)/);
                    const hasFullSignal = text.includes("completa") || text.includes("full") || text.includes("agotado");

                    if (dispoMatch && !hasFullSignal) {
                        const spots = parseInt(dispoMatch[1]);
                        if (spots > 0 && !diaResuelto) {
                            const msg = `🚨 ¡CUPO EN ORIGEN!\n📅 ${day}\n🕒 ${hour}:00\n👥 ${spots} disponibles.`;
                            log(msg);
                            if (client) await client.messages.create({ 
                                body: msg, from: process.env.TWILIO_FROM, to: process.env.TWILIO_TO 
                            });
                            diaResuelto = true;
                            break;
                        }
                    }
                }
            }
        }
    } catch (e) {
        log(`❌ Error crítico: ${e.message}`);
    } finally {
        await browser.close();
        log("🧹 Proceso finalizado.");
    }
}

run();