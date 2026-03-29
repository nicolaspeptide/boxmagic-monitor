import { chromium } from 'playwright';
import twilio from 'twilio';

// Configuración con priorización de Variables de Entorno
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
    log("🚀 Iniciando rastreo senior de agenda completa...");
    const browser = await chromium.launch({ 
        headless: true, 
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] 
    });
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36' });
    const page = await context.newPage();

    try {
        log("🔐 Accediendo a Boxmagic...");
        await page.goto(CONFIG.url, { waitUntil: 'networkidle', timeout: 60000 });
        
        // Login robusto
        await page.fill('input[type="email"]', CONFIG.email);
        await page.fill('input[type="password"]', CONFIG.pass);
        await Promise.all([
            page.click('button[type="submit"], button:has-text("Entrar"), button:has-text("Sign in")'),
            page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {})
        ]);
        log("✅ Login completado.");

        // Ir directamente a la vista de horarios
        const scheduleUrl = "https://members.boxmagic.app/a/g/oGDPQaGLb5/schedule";
        await page.goto(scheduleUrl, { waitUntil: 'networkidle' });
        await page.waitForTimeout(4000);

        const dayMap = {
            monday: [/lunes/i, /monday/i, /^lun$/i, /^mon$/i],
            tuesday: [/martes/i, /tuesday/i, /^mar$/i, /^tue$/i],
            wednesday: [/miércoles/i, /miercoles/i, /wednesday/i, /^mie$/i, /^wed$/i],
            friday: [/viernes/i, /friday/i, /^vie$/i, /^fri$/i]
        };

        for (const [day, targetHours] of Object.entries(CONFIG.schedules)) {
            log(`🔎 Revisando: ${day}...`);
            
            // Buscar y hacer clic en el tab del día
            let dayButton = null;
            for (const regex of dayMap[day]) {
                const found = page.locator('button, span, a, .day-selector, .calendar-day').filter({ hasText: regex }).first();
                if (await found.count() > 0) {
                    dayButton = found;
                    break;
                }
            }

            if (dayButton) {
                await dayButton.click();
                await page.waitForTimeout(3000); // Espera a que carguen las clases del día
            } else {
                log(`⚠️ No se encontró el botón para ${day}. Saltando.`);
                continue;
            }

            // Identificar tarjetas de clase
            const cards = await page.locator('div[class*="card"], .session-item, [role="listitem"], .class-box, article').all();
            let diaResuelto = false;

            for (const card of cards) {
                const rawText = await card.innerText();
                const text = rawText.toLowerCase().replace(/\s+/g, ' ');
                
                // Extraer hora (soporta 19:00, 7:00pm, 19:00 hrs)
                const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
                if (!timeMatch) continue;
                
                let hour = parseInt(timeMatch[1]);
                // Convertir PM a 24h si es necesario
                if ((text.includes("pm") || text.includes("tarde") || text.includes("noche")) && hour < 12) hour += 12;

                if (targetHours.includes(hour)) {
                    // REGLA 1: ¿Ya está reservado? (Detección por texto o botones de cancelar)
                    const isBooked = text.includes("reservado") || text.includes("inscrito") || 
                                     text.includes("mi cupo") || text.includes("cancelar") || 
                                     text.includes("booked") || text.includes("your reservation");
                    
                    if (isBooked) {
                        log(`✅ ${day} @ ${hour}:00 -> YA RESERVADO. Objetivo cumplido.`);
                        diaResuelto = true;
                        break; // No miramos más horas para este día
                    }

                    // REGLA 2: Disponibilidad Real
                    const dispoMatch = text.match(/(\d+)\s*(cupos|disponibles|espacios|slots|available)/);
                    const isFull = text.includes("completa") || text.includes("full") || text.includes("agotado") || text.includes("0 cupos");

                    if (dispoMatch && !isFull && !diaResuelto) {
                        const spots = parseInt(dispoMatch[1]);
                        if (spots > 0) {
                            const msg = `🚨 ¡CUPOS EN ORIGEN!\n📅 Día: ${day}\n🕒 Hora: ${hour}:00\n👥 Cupos: ${spots}\n\nReserva en la App pronto!`;
                            log(msg);
                            if (client) await client.messages.create({ 
                                body: msg, from: process.env.TWILIO_FROM, to: process.env.TWILIO_TO 
                            });
                            diaResuelto = true;
                            break; // Una vez avisado, marcamos el día como resuelto
                        }
                    }
                }
            }
        }
    } catch (e) {
        log(`❌ ERROR CRÍTICO: ${e.message}`);
    } finally {
        await browser.close();
        log("🧹 Monitor finalizado.");
    }
}

run();