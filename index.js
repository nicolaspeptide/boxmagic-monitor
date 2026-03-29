const axios = require("axios");
const cheerio = require("cheerio");
const twilio = require("twilio");

// ======================
// CONFIG
// ======================

const URL = "https://members.boxmagic.app/a/g/oGDPQaGLb5/perfil?o=a-iugpd";

// horarios que quieres vigilar
const TARGET_CLASSES = [
  { day: "Lunes", hours: ["19:00", "20:00"] },
  { day: "Martes", hours: ["19:00", "20:00"] },
  { day: "Miércoles", hours: ["20:00"] },
  { day: "Viernes", hours: ["19:00"] }
];

// Twilio
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM = "whatsapp:+14155238886"; // sandbox Twilio
const TO = "whatsapp:+569XXXXXXXX";   // tu número

// ======================
// SCRAPING
// ======================

async function checkClasses() {
  try {
    console.log("🔍 Revisando clases...");

    const response = await axios.get(URL);
    const html = response.data;

    const $ = cheerio.load(html);

    let found = false;

    $(".class-card").each((i, el) => {
      const text = $(el).text();

      TARGET_CLASSES.forEach(target => {
        if (text.includes(target.day)) {
          target.hours.forEach(hour => {
            if (text.includes(hour)) {

              // detectar disponibilidad
              const hasSpot =
                text.includes("cupo") ||
                text.includes("disponible") ||
                text.match(/\b[1-9]\b/);

              const isFull = text.includes("completa");

              if (hasSpot && !isFull) {
                found = true;

                sendWhatsApp(
                  `🔥 Cupo disponible:\n${target.day} ${hour}\n¡Reserva ahora!`
                );
              }
            }
          });
        }
      });
    });

    if (!found) {
      console.log("😴 Sin cambios");
    }

  } catch (error) {
    console.error("❌ Error scraping:", error.message);
  }
}

// ======================
// WHATSAPP
// ======================

async function sendWhatsApp(message) {
  try {
    await client.messages.create({
      body: message,
      from: FROM,
      to: TO
    });

    console.log("📲 WhatsApp enviado:", message);

  } catch (error) {
    console.error("❌ Error WhatsApp:", error.message);
  }
}

// ======================
// LOOP
// ======================

function startMonitor() {
  console.log("🚀 Monitor iniciado...");

  checkClasses();

  setInterval(() => {
    checkClasses();
  }, 60 * 1000); // cada 60 segundos
}

startMonitor();