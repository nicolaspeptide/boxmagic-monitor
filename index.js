import { chromium } from 'playwright';
import twilio from 'twilio';

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
    log("🚀 Iniciando Motor Senior con User-Agent Real...");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    
    // Usamos un contexto con User-Agent de Chrome real para evitar bloqueos
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        log("🔗 Accediendo a la raíz de Boxmagic...");
        await page.goto("https://members.boxmagic.app/", { waitUntil: 'networkidle' });

        // Si no estamos en login, buscamos el botón para entrar
        if (await page.locator('input[type="email"]').count() === 0) {
            log("🖱️ Buscando botón de inicio de sesión...");
            const loginBtn = page.locator('a:has-text("Ingresar"), a:has-text("Login"), .btn-login').first();
            if (await loginBtn.count() > 0) await loginBtn.click();
            await page.waitForTimeout(3000);
        }

        log("⌨️ Rellenando credenciales...");
        // Usamos selectores más genéricos por si cambiaron los IDs
        await page.locator('input[name="email"], input[type="email"]').first().fill(CONFIG.email);
        await page.locator('input[name="password"], input[type="password"]').first().fill(CONFIG.pass);
        
        await Promise.all([
            page.click('button[type="submit"], .btn-primary, button:has-text("Entrar")'),
            page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {})
        ]);

        log("✅ Login exitoso. Buscando Agenda...");
        await page.waitForTimeout(5000);

        // Intentamos detectar la URL de agenda desde el menú
        const scheduleLink = page.locator('a[href*="schedule"], a:has-text("Agenda")').first();
        if (await scheduleLink.count() > 0) {
            await scheduleLink.click();
        } else {
            log("⚠️ Forzando ruta de agenda...");
            await page.goto("https://members.boxmagic.app/schedule", { waitUntil: 'networkidle' });
        }

        await page.waitForTimeout(5000);

        const dayKeywords = {
            monday: [/lunes/i, /monday/i, /lun/i],
            tuesday: [/martes/i, /tuesday/i, /mar/i],
            wednesday: [/miércoles/i, /miercoles/i, /wednesday/i, /mie/i],
            friday: [/viernes/i, /friday/i, /vie/i]
        };

        for (const [day, targetHours] of Object.entries(CONFIG.schedules)) {
            log(`🔎 Revisando día: ${day}...`);
            
            const dayButton = page.locator('button, a, span, div').filter({ hasText: dayKeywords[day][0] }).first();

            if (await dayButton.count() > 0) {
                await dayButton.click({ force: true });
                await page.waitForTimeout(4000);
            } else {
                log(`❌ ${day} no encontrado.`);
                continue;
            }

            const cards = await page.locator('div, article, section').filter({ hasText: /\d{1,2}:\d{2}/ }).all();
            
            for (const card of cards) {
                const text = (await card.innerText()).toLowerCase().replace(/\s+/g, ' ');
                const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
                if (!timeMatch) continue;
                
                let hour = parseInt(timeMatch[1]);
                if (text.includes("pm") && hour < 12) hour += 12;

                if (targetHours.includes(hour)) {
                    log(`⏰ Analizando ${day} @ ${hour}:00`);
                    
                    const isBooked = /reservado|inscrito|mi cupo|cancelar|booked/.test(text);
                    if (isBooked) {
                        log(`✅ ${day} @ ${hour}:00 -> YA RESERVADO.`);
                        break; 
                    }

                    const dispoMatch = text.match(/(\d+)\s*(cupos|disponibles|espacios)/);
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