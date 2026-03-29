const puppeteer = require("puppeteer");
const twilio = require("twilio");

// ======================
// CONFIG
// ======================

const EMAIL = process.env.BOXMAGIC_EMAIL;
const PASSWORD = process.env.BOXMAGIC_PASSWORD;

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

const FROM = "whatsapp:+14155238886";
const TO = "whatsapp:+569XXXXXXXX";

// ======================
// BOT
// ======================

async function checkClasses() {
  console.log("🔍 Abriendo navegador...");

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  try {
    // ======================
    // LOGIN
    // ======================

    console.log("🔐 Login...");

    await page.goto("https://members.boxmagic.app/login", {
      waitUntil: "networkidle2"
    });

    await page.type('input[type="email"]', EMAIL);
    await page.type('input[type="password"]', PASSWORD);

    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation()
    ]);

    console.log("✅ Logeado");

    // ======================
    // IR A HORARIOS
    // ======================

    await page.goto("https://members.boxmagic.app/", {
      waitUntil: "networkidle2"
    });

    await page.waitForTimeout(3000);

    const content = await page.content();

    let found = false;

    TARGET_CLASSES.forEach(target => {
      target.hours.forEach(hour => {

        if (
          content.includes(target.day) &&
          content.includes(hour)
        ) {

          // detectar disponibilidad
          if (
            content.includes("cupo") ||
            content.includes("disponible")
          ) {
            found = true;

            sendWhatsApp(
              `🔥 Cupo disponible:\n${target.day} ${hour}`
            );
          }
        }

      });
    });

    if (!found) {
      console.log("😴 Sin cupos");
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
  }

  await browser.close();
}

// ======================
// WHATSAPP
// ======================

async function sendWhatsApp(message) {
  await client.messages.create({
    body: message,
    from: FROM,
    to: TO
  });

  console.log("📲 WhatsApp enviado:", message);
}

// ======================
// LOOP
// ======================

function startMonitor() {
  console.log("🚀 Monitor iniciado");

  checkClasses();

  setInterval(checkClasses, 60 * 1000);
}

startMonitor();