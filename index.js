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

  return /\b[1-9]\d*\b/.test(text);
}

async function tryLogin(page) {
  console.log("🔐 Abriendo login...");

  await page.goto("https://members.boxmagic.app/login", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(5000);

  console.log("🌍 URL actual:", page.url());

  const bodyText = await page.locator("body").innerText().catch(() => "");
  console.log("🧪 Texto visible login:", bodyText.slice(0, 1500));

  const preLoginButtons = [
    'text=/iniciar sesión/i',
    'text=/iniciar sesion/i',
    'text=/entrar/i',
    'text=/login/i',
    'text=/continuar/i'
  ];

  for (const selector of preLoginButtons) {
    try {
      const el = page.locator(selector).first();
      if (await el.count()) {
        await el.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(3000);
        console.log("✅ Botón previo clickeado:", selector);
        break;
      }
    } catch {}
  }

  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[id*="email"]',
    'input[placeholder*="mail"]',
    'input[placeholder*="correo"]',
    'input[autocomplete="username"]'
  ];

  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[id*="password"]',
    'input[placeholder*="contraseña"]',
    'input[placeholder*="password"]',
    'input[autocomplete="current-password"]'
  ];

  let emailSelectorFound = null;
  for (const selector of emailSelectors) {
    const count = await page.locator(selector).count().catch(() => 0);
    if (count > 0) {
      emailSelectorFound = selector;
      break;
    }
  }

  if (!emailSelectorFound) {
    throw new Error(`No encontré el campo de email. URL actual: ${page.url()}`);
  }

  await page.fill(emailSelectorFound, EMAIL);
  console.log("✅ Campo email encontrado:", emailSelectorFound);

  let passwordSelectorFound = null;
  for (const selector of passwordSelectors) {
    const count = await page.locator(selector).count().catch(() => 0);
    if (count > 0) {
      passwordSelectorFound = selector;
      break;
    }
  }

  if (!passwordSelectorFound) {
    throw new Error(`No encontré el campo de password. URL actual: ${page.url()}`);
  }

  await page.fill(passwordSelectorFound, PASSWORD);
  console.log("✅ Campo password encontrado:", passwordSelectorFound);

  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Ingresar")',
    'button:has-text("Entrar")',
    'button:has-text("Iniciar sesión")',
    'button:has-text("Iniciar sesion")',
    'button:has-text("Login")',
    'text=/ingresar/i',
    'text=/entrar/i'
  ];

  let submitted = false;

  for (const selector of submitSelectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.count()) {
        await el.click({ timeout: 3000 });
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        submitted = true;
        console.log("✅ Botón submit encontrado:", selector);
        break;
      }
    } catch {}
  }

  if (!submitted) {
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    console.log("⚠️ Submit por Enter");
  }

  await page.waitForTimeout(4000);
  console.log("✅ Intento de login realizado. URL final:", page.url());
}

async function openHorarios(page) {
  console.log("📅 Abriendo horarios...");

  await page.goto("https://members.boxmagic.app/", {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForTimeout(4000);

  const horariosCandidates = [
    'text=/horarios/i',
    'text=/agenda/i',
    'text=/clases/i',
    'a[href*="schedule"]',
    'a[href*="horario"]',
    'a[href*="agenda"]',
    'a[href*="class"]'
  ];

  for (const selector of horariosCandidates) {
    try {
      const el = page.locator(selector).first();
      if (await el.count()) {
        await el.click({ timeout: 4000 }).catch(() => {});
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(3000);
        console.log("✅ Se abrió horarios con selector:", selector);
        console.log("🌍 URL horarios:", page.url());
        return;
      }
    } catch {}
  }

  console.log("⚠️ No encontré link explícito de horarios, sigo con la pantalla actual");
  console.log("🌍 URL actual horarios:", page.url());
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
    const text = await page.locator("body").innerText().catch(() => "");

    console.log("🧪 Contenido cargado, revisando clases...");

    let found = false;
    const joined = `${text}\n${content}`;

    for (const target of TARGET_CLASSES) {
      for (const hour of target.hours) {
        const match = matchesTarget(joined, target.day, hour);
        if (!match) continue;

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