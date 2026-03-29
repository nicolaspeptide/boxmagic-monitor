const { chromium } = require('playwright');
const twilio = require('twilio');

// Configuración de entorno
const CONFIG = {
    user: process.env.BOXMAGIC_USER,
    pass: process.env.BOXMAGIC_PASS,
    whatsappFrom: `whatsapp:${process.env.TWILIO_NUMBER}`,
    whatsappTo: `whatsapp:${process.env.MY_NUMBER}`,
    targetSchedules: ['19:00', '20:00'], // Tus horarios objetivo
    daysToCheck: 7 // Ventana de días a revisar
};

const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

async function sendAlert(message) {
    try {
        await client.messages.create({
            body: message,
            from: CONFIG.whatsappFrom,
            to: CONFIG.whatsappTo
        });
        console.log("✅ Alerta enviada:", message);
    } catch (e) {
        console.error("❌ Error Twilio:", e.message);
    }
}

async function monitor() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        // 1. LOGIN
        await page.goto('https://boxmagic.cl/login'); // Ajustar URL si es necesario
        await page.fill('input[type="email"]', CONFIG.user);
        await page.fill('input[type="password"]', CONFIG.pass);
        await page.click('button[type="submit"]');
        await page.waitForNavigation();

        // 2. NAVEGAR A HORARIOS ORIGEN
        await page.goto('https://boxmagic.cl/pro/origen-performance-center/schedule'); 
        await page.waitForLoadState('networkidle');

        let diasResueltos = {}; // Control de avisos por jornada

        // 3. REVISIÓN DÍA POR DÍA
        for (let i = 0; i < CONFIG.daysToCheck; i++) {
            // Lógica para hacer click en el día del calendario (según tu estructura)
            // Supongamos que usas clickDayByStructure(i)
            const diaActual = await seleccionarDia(page, i); 
            
            if (diasResueltos[diaActual]) continue;

            // 4. AISLAR BLOQUES DE CLASE
            const sessionBlocks = await page.locator('.class-card, .session-item').all(); // Ajustar selector real

            for (const block of sessionBlocks) {
                const text = (await block.innerText()).toLowerCase();
                const horaClase = await extraerHora(text);

                if (!CONFIG.targetSchedules.includes(horaClase)) continue;

                // REGLA 1: ¿Ya estoy reservado en este horario o en este día?
                const isBooked = text.includes('reservado') || text.includes('mi cupo') || text.includes('cancelar');
                if (isBooked) {
                    console.log(`📅 Día ${diaActual}: Ya tienes reserva a las ${horaClase}. Saltando día.`);
                    diasResueltos[diaActual] = true;
                    break; 
                }

                // REGLA 2: Disponibilidad Real (Anti Falsos Positivos)
                // Ignorar si dice "Completo" o similar
                if (text.includes('capacidad completa') || text.includes('full') || text.includes('0 cupos')) {
                    continue;
                }

                // Buscar patrón de números: "X cupos", "X disponibles", "X slots"
                const matchDispo = text.match(/(\d+)\s*(cupos|disponibles|espacios|slots)/);
                if (matchDispo) {
                    const cupos = parseInt(matchDispo[1]);
                    if (cupos > 0) {
                        await sendAlert(`🚀 ¡CUPO EN ORIGEN! Día: ${diaActual}, Hora: ${horaClase}. Quedan ${cupos} espacios.`);
                        diasResueltos[diaActual] = true; // Marcamos como resuelto para no spamear más este día
                        break;
                    }
                }
            }
        }

    } catch (error) {
        console.error("🔴 Error en el monitor:", error);
    } finally {
        await browser.close();
    }
}

// Helpers rápidos (Personalizar según el DOM exacto de Boxmagic)
async function seleccionarDia(page, offset) {
    // Aquí va tu lógica de clickDayByStructure
    // Retorna un string "YYYY-MM-DD" para el objeto diasResueltos
    return new Date(Date.now() + offset * 86400000).toISOString().split('T')[0];
}

async function extraerHora(text) {
    const match = text.match(/(\d{2}:\d{2})/);
    return match ? match[1] : null;
}

monitor();