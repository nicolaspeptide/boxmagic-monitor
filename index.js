const { chromium } = require("playwright");
const twilio = require("twilio");

// ======================================================
// CONFIG (Priorizando Variables de Entorno)
// ======================================================
const BOXMAGIC_ENTRY_URL = process.env.BOXMAGIC_ENTRY_URL || "https://members.boxmagic.app/a/g/oGDPQaGLb5/perfil?o=a-iugpd";
const BOXMAGIC_EMAIL = process.env.BOXMAGIC_EMAIL || "";
const BOXMAGIC_PASSWORD = process.env.BOXMAGIC_PASSWORD || "";
const TARGET_SCHEDULES = {
  monday: [19, 20],
  tuesday: [19, 20],
  wednesday: [20],
  friday: [19]
};

const twilioClient = (process.env.TWILIO_SID && process.env.TWILIO_TOKEN) 
    ? twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN) 
    : null;

function log(msg) { console.log(`${new Date().toISOString()} | ${msg}`); }

// ======================================================
// LÓGICA DE NEGOCIO "ENDURECIDA"
// ======================================================

function isAlreadyBooked(text) {
    const low = text.toLowerCase();
    return low.includes("reservado") || low.includes("tu cupo") || low.includes("inscrito") || low.includes("booked");
}

function getAvailability(text) {
    const low = text.toLowerCase();
    // Veto absoluto si detecta palabras de "lleno"
    if (low.includes("completa") || low.includes("full") || low.includes("agotado") || low.includes("0 cupos")) {
        return { available: false, spots: 0 };
    }
    // Solo confiar si hay un número seguido de palabras de disponibilidad
    const match = low.match(/(\d+)\s*(cupos|disponibles|espacios|slots|available)/);
    if (match) {
        const count = parseInt(match[1]);
        return { available: count > 0, spots: count };
    }
    return { available: false, spots: 0 };
}

async function runMonitor() {
    log("🚀 Iniciando monitor ultra-estricto...");
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage();

    try {
        // 1. LOGIN
        await page.goto(BOXMAGIC_ENTRY_URL);
        await page.fill('input[type="email"]', BOXMAGIC_EMAIL);
        await page.fill('input[type="password"]', BOXMAGIC_PASSWORD);
        await page.click('button[type="submit"], button:has-text("Entrar")');
        await page.waitForTimeout(5000);

        // 2. IR A HORARIOS (Asegurando que cargue la vista de Origen)
        await page.goto("https://members.boxmagic.app/a/g/oGDPQaGLb5/schedule"); 
        await page.waitForLoadState('networkidle');

        for (const [day, hours] of Object.entries(TARGET_SCHEDULES)) {
            log(`Checking ${day}...`);
            
            // Intentar abrir el tab del día
            const dayTab = page.locator(`button:has-text("${day}"), span:has-text("${day}")`).first();
            if (await dayTab.count() > 0) {
                await dayTab.click();
                await page.waitForTimeout(2000);
            }

            // REGLA DE ORO: Si ya hay una reserva hoy, no avisar por nada más
            let diaYaResuelto = false;
            
            // Buscamos tarjetas de clase (Boxmagic suele usar .card o div con bordes)
            const cards = await page.locator('div.card, .session-item, [role="listitem"]').all();

            for (const card of cards) {
                const rawText = await card.innerText();
                const text = rawText.replace(/\n/g, " ");
                
                // Extraer hora de la tarjeta (ej: 19:00)
                const timeMatch = text.match(/(\d{2}:\d{2})/);
                if (!timeMatch) continue;
                const cardHour = parseInt(timeMatch[1].split(":")[0]);

                if (hours.includes(cardHour)) {
                    // Check 1: ¿Ya estoy anotado?
                    if (isAlreadyBooked(text)) {
                        log(`✅ ${day} @ ${cardHour}:00 ya está CUBIERTO por reserva previa.`);
                        diaYaResuelto = true;
                        break; // Rompe el loop de tarjetas de este día
                    }

                    // Check 2: ¿Hay cupo real?
                    const { available, spots } = getAvailability(text);
                    if (available && !diaYaResuelto) {
                        const alertMsg = `🚨 CUPO REAL en Origen!\n📅 Día: ${day}\n🕒 Hora: ${cardHour}:00\n👥 Cupos: ${spots}\n\nReserva rápido en la App!`;
                        log(alertMsg);
                        
                        if (twilioClient) {
                            await twilioClient.messages.create({
                                body: alertMsg,
                                from: process.env.TWILIO_FROM,
                                to: process.env.TWILIO_TO
                            });
                        }
                        diaYaResuelto = true; // No avisar más por este día aunque haya otra hora
                        break; 
                    }
                }
            }
        }
    } catch (e) {
        log(`❌ ERROR: ${e.message}`);
    } finally {
        await browser.close();
        log("🧹 Monitor cerrado.");
    }
}

runMonitor();