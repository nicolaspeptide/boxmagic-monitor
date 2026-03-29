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
    log("🚀 Iniciando Motor de Precisión...");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        log("🔑 Logueando...");
        await page.goto("https://members.boxmagic.app/auth/login", { waitUntil: 'networkidle' });
        await page.fill('input[type="email"]', CONFIG.email);
        await page.fill('input[type="password"]', CONFIG.pass);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(7000);

        log("📅 Navegando a la Agenda...");
        // Intentamos la URL directa que vimos que funciona pero no carga rápido
        await page.goto("https://members.boxmagic.app/schedule", { waitUntil: 'domcontentloaded' });
        
        // ESPERA CRÍTICA: No seguimos hasta que aparezca la palabra "Lunes" o "Monday" en la pantalla
        log("⏳ Esperando a que el calendario se dibuje...");
        await page.waitForFunction(() => 
            document.body.innerText.toLowerCase().includes('lunes') || 
            document.body.innerText.toLowerCase().includes('monday'),
            { timeout: 20000 }
        ).catch(() => log("⚠️ El calendario tarda en cargar, intentando buscar igual..."));

        const dayKeywords = {
            monday: [/lunes/i, /monday/i],
            tuesday: [/martes/i, /tuesday/i],
            wednesday: [/miércoles/i, /miercoles/i, /wednesday/i],
            friday: [/viernes/i, /friday/i]
        };

        for (const [day, targetHours] of Object.entries(CONFIG.schedules)) {
            log(`🔎 Buscando día: ${day}...`);
            
            // Buscamos el elemento que contenga el texto del día y sea cliqueable
            const dayButton = page.getByText(dayKeywords[day][0]).first();

            if (await dayButton.count() > 0) {
                log(`🖱️ Click en ${day}`);
                await dayButton.click({ force: true });
                await page.waitForTimeout(3000); // Espera a que carguen las clases de ese día
            } else {
                log(`❌ No se encontró rastro visual de ${day}`);
                continue;
            }

            // Buscamos las tarjetas de clase
            const cards = await page.locator('div, article, li').filter({ hasText: /\d{1,2}:\d{2}/ }).all();
            
            for (const card of cards) {
                const text = (await card.innerText()).toLowerCase();
                const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
                if (!timeMatch) continue;
                
                let hour = parseInt(timeMatch[1]);
                if (text.includes("pm") && hour < 12) hour += 12;

                if (targetHours.includes(hour)) {
                    log(`⏰ Clase detectada a las ${hour}:00`);
                    
                    const isBooked = /reservado|inscrito|mi cupo|cancelar/.test(text);
                    if (isBooked) {
                        log(`✅ Ya estás inscrito en ${day} ${hour}:00`);
                        break; 
                    }

                    const dispoMatch = text.match(/(\d+)\s*(cupos|disponibles|espacios)/);
                    if (dispoMatch && !/completa|0 cupos/.test(text)) {
                        const spots = parseInt(dispoMatch[1]);
                        if (spots > 0) {
                            const msg = `🚨 ¡CUPOS DISPONIBLES!\n📅 ${day}\n🕒 ${hour}:00\n👥 ${spots} libres.`;
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
        log("🧹 Proceso finalizado.");
    }
}

run();