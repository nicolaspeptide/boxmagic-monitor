const { chromium } = require("playwright");
const twilio = require("twilio");

const EMAIL = process.env.BOXMAGIC_EMAIL;
const PASSWORD = process.env.BOXMAGIC_PASSWORD;

const TARGET_CLASSES = [
  { day: "Lunes", hours: ["19:00", "20:00"] },
  { day: "Martes", hours: ["19:00", "20:00"] },
  { day: "Miércoles", hours: ["20:00"] },
  { day: "Viernes", hours: ["19:00"] }
];

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const FROM = "whatsapp:+14155238886";
const TO = process.env.WHATSAPP_TO;

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

function matchesTarget(text, day, hour) {
  return text.includes(day) && text.includes(hour);
}

function hasAvailability(text) {
  const t = text.toLowerCase();
  if (t.includes("capacidad completa")) return false;
  if (t.includes("completa")) return false;
  if (t.includes("sin cupos")) return false;
  if (t.includes("sin espacios")) return false;
  if (t.includes("disponible")) return true;
  if (t.includes("cupo")) return true;
  if (/\b[1-9]\d*\b/.test(text)) return true;
  return false;
}

async function tryLogin(page) {
  console.log("🔐 Abriendo login...");
  await page.goto("https://members.boxmagic.app/login", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(2000);

  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[placeholder*="mail"]',
    'input[placeholder*="correo"]'
  ];

  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[placeholder*="contraseña"]',
    'input[placeholder*="password"]'
  ];

  let emailFound = false;
  for (const selector of emailSelectors) {
    const el = await page.$(selector);
    if (el) {
      await page.fill(selector, EMAIL);
      emailFound = true;
      console.log("✅ Campo email encontrado:", selector);
      break;
    }
  }

  if (!emailFound) {
    throw new Error("No encontré el campo de email");
  }

  let passwordFound = false;
  for (const selector of passwordSelectors) {
    const el = await page.$(selector);
    if (el) {
      await page.fill(selector, PASSWORD);
      passwordFound = true;
      console.log("✅ Campo password encontrado:", selector);
      break;
    }
  }

  if (!passwordFound) {
    throw new Error("No encontré el campo de password");
  }

  const submitSelectors = [
    'button[type="submit"]',
    'button:has-text("Ingresar")',
    'button:has-text("Entrar")',
    'button:has-text("Iniciar sesión")',
    'button:has-text("Login")'
  ];

  let clicked = false;
  for (const selector of submitSelectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        await Promise.all([
          page.click(selector),
          page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {})
        ]);
        clicked = true;
        console.log("✅ Botón login encontrado:", selector);
        break;
      }
    } catch {}
  }

  if (!clicked) {
    throw new Error("No encontré el botón de login");
  }

  console.log("✅ Intento de login realizado");
}

async function openHorarios(page) {
  console.log("📅 Abriendo horarios...");
  await page.goto("https://members.boxmagic.app/", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(4000);

  const horariosLink = await page.locator('text=/horarios/i').first();
  if (await horariosLink.count()) {
    await horariosLink.click().catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    console.log("✅ Se abrió horarios desde link");
    return;
  }

  console.log("⚠️ No encontré link explícito de horarios, reviso contenido actual");
}

async function checkClasses() {
  console.log("🚀 Monitor iniciado...");
  console.log("🔍 Abriendo navegador...");

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  try {
    await tryLogin(page);
    await openHorarios(page);

    const content = await page.content();
    const text = await page.locator("body").innerText();

    console.log("🧪 Contenido cargado, revisando clases...");

    let found = false;

    for (const target of TARGET_CLASSES) {
      for (const hour of target.hours) {
        const ok = matchesTarget(text, target.day, hour) || matchesTarget(content, target.day, hour);

        if (!ok) continue;

        const joined = `${text}\n${content}`;
        if (hasAvailability(joined)) {
          found = true;
          const msg = `🔥 Cupo disponible: ${target.day} ${hour}`;
          console.log(msg);
          await sendWhatsApp(msg);
        }
      }
    }

    if (!found) {
      console.log("😴 Sin cupos en horarios objetivo");
    }

  } catch (error) {
    console.error("❌ Error scraping:", error.message);
  } finally {
    await browser.close();
    console.log("🧹 Browser cerrado");
  }
}

checkClasses();
setInterval(checkClasses, 60 * 1000);