const { chromium } = require("playwright");
const twilio = require("twilio");

const BOXMAGIC_ENTRY_URL =
  process.env.BOXMAGIC_ENTRY_URL ||
  "https://members.boxmagic.app/a/g/oGDPQaGLb5/perfil?o=a-iugpd";

const EMAIL = process.env.BOXMAGIC_EMAIL;
const PASSWORD = process.env.BOXMAGIC_PASSWORD;

const TARGET_CLASSES = [
  { day: "Lunes", hours: ["19:00", "20:00"] },
  { day: "Martes", hours: ["19:00", "20:00"] },
  { day: "Miércoles", hours: ["20:00"] },
  { day: "Viernes", hours: ["19:00"] }
];

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const WHATSAPP_TO = process.env.WHATSAPP_TO;
const WHATSAPP_FROM = process.env.WHATSAPP_FROM || "whatsapp:+14155238886";

const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 300000);

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function sendWhatsApp(message) {
  if (!twilioClient) {
    log("⚠️ Twilio no configurado. Mensaje no enviado:", message);
    return;
  }

  if (!WHATSAPP_TO) {
    log("⚠️ WHATSAPP_TO no configurado. Mensaje no enviado:", message);
    return;
  }

  try {
    await twilioClient.messages.create({
      body: message,
      from: WHATSAPP_FROM,
      to: WHATSAPP_TO
    });
    log("📲 WhatsApp enviado:", message);
  } catch (error) {
    log("❌ Error WhatsApp:", error.message);
  }
}

function normalizeText(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    .replace(/[áàäâ]/gi, "a")
    .replace(/[éèëê]/gi, "e")
    .replace(/[íìïî]/gi, "i")
    .replace(/[óòöô]/gi, "o")
    .replace(/[úùüû]/gi, "u")
    .toLowerCase()
    .trim();
}

function includesAny(text, terms) {
  const t = normalizeText(text);
  return terms.some(term => t.includes(normalizeText(term)));
}

function hasAvailability(text) {
  const t = normalizeText(text);

  if (t.includes("capacidad completa")) return false;
  if (t.includes("sin cupos")) return false;
  if (t.includes("sin espacios")) return false;
  if (t.includes("completa")) return false;

  if (t.includes("espacios disponibles")) return true;
  if (t.includes("disponible")) return true;
  if (t.includes("cupo")) return true;

  return /\b([1-9][0-9]*)\b/.test(text || "");
}

function looksLikeBooked(text) {
  const t = normalizeText(text);
  return (
    t.includes("inscrito") ||
    t.includes("reservado") ||
    t.includes("booked") ||
    t.includes("agendado") ||
    t.includes("ya estas inscrito") ||
    t.includes("ya estás inscrito")
  );
}

function matchDay(text, day) {
  return includesAny(text, [day]);
}

function matchHour(text, hour) {
  return (text || "").includes(hour);
}

async function dumpVisibleText(page, label) {
  try {
    const bodyText = await page.locator("body").innerText();
    log(`🧪 ${label}:`, bodyText.slice(0, 2000));
  } catch (e) {
    log(`⚠️ No pude leer bodyText en ${label}:`, e.message);
  }
}

async function gotoEntry(page) {
  log("🌐 Abriendo entry URL...");
  await page.goto(BOXMAGIC_ENTRY_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });
  await page.waitForTimeout(5000);
  log("🌍 URL actual:", page.url());
  await dumpVisibleText(page, "Texto visible entry");
}

async function maybeClickAccessButtons(page) {
  const selectors = [
    'text=/iniciar sesion/i',
    'text=/iniciar sesión/i',
    'text=/entrar/i',
    'text=/login/i',
    'text=/continuar/i',
    'text=/acceder/i',
    'text=/ingresar/i'
  ];

  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.count()) {
        await el.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(3000);
        log("✅ Click previo en:", selector);
        log("🌍 URL tras click:", page.url());
        return;
      }
    } catch {}
  }
}

async function fillIfExists(page, selectors, value, label) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.count()) {
        await locator.fill(value, { timeout: 3000 });
        log(`✅ Campo ${label} encontrado:`, selector);
        return selector;
      }
    } catch {}
  }
  return null;
}

async function doLoginIfNeeded(page) {
  await maybeClickAccessButtons(page);

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
    'input[placeholder*="contras"]',
    'input[placeholder*="password"]',
    'input[autocomplete="current-password"]'
  ];

  const emailSelector = await fillIfExists(page, emailSelectors, EMAIL, "email");

  if (!emailSelector) {
    log("ℹ️ No apareció campo email. Asumo que no hace falta login en esta pantalla.");
    return;
  }

  const passwordSelector = await fillIfExists(
    page,
    passwordSelectors,
    PASSWORD,
    "password"
  );

  if (!passwordSelector) {
    throw new Error("Apareció email pero no apareció campo password");
  }

  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Ingresar")',
    'button:has-text("Entrar")',
    'button:has-text("Iniciar sesión")',
    'button:has-text("Iniciar sesion")',
    'button:has-text("Login")',
    'text=/ingresar/i',
    'text=/entrar/i',
    'text=/continuar/i'
  ];

  let submitted = false;

  for (const selector of submitSelectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.count()) {
        await el.click({ timeout: 4000 });
        await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(5000);
        log("✅ Submit login con:", selector);
        submitted = true;
        break;
      }
    } catch {}
  }

  if (!submitted) {
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);
    log("⚠️ Submit login por Enter");
  }

  log("🌍 URL post-login:", page.url());
  await dumpVisibleText(page, "Texto visible post-login");
}

async function goToSchedule(page) {
  log("📅 Buscando vista de horarios...");

  const selectors = [
    'text=/horarios/i',
    'text=/agenda/i',
    'text=/clases/i',
    'text=/reservas/i',
    'a[href*="schedule"]',
    'a[href*="agenda"]',
    'a[href*="class"]',
    'a[href*="horario"]',
    'button:has-text("Horarios")',
    'button:has-text("Clases")'
  ];

  for (const selector of selectors) {
    try {
      const el = page.locator(selector).first();
      if (await el.count()) {
        await el.click({ timeout: 4000 }).catch(() => {});
        await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(4000);
        log("✅ Navegué a horarios con:", selector);
        log("🌍 URL horarios:", page.url());
        await dumpVisibleText(page, "Texto visible horarios");
        return;
      }
    } catch {}
  }

  log("⚠️ No encontré botón/link de horarios. Revisaré la página actual.");
  log("🌍 URL actual para scraping:", page.url());
  await dumpVisibleText(page, "Texto visible sin navegar horarios");
}

async function collectCandidateCards(page) {
  const selectors = [
    '[class*="class"]',
    '[class*="schedule"]',
    '[class*="event"]',
    '[class*="booking"]',
    '[class*="card"]',
    'article',
    'li',
    'div'
  ];

  for (const selector of selectors) {
    try {
      const loc = page.locator(selector);
      const count = await loc.count();
      if (count > 0) {
        const items = [];
        const limit = Math.min(count, 300);

        for (let i = 0; i < limit; i++) {
          const item = loc.nth(i);
          const text = await item.innerText().catch(() => "");
          if (text && text.trim().length > 0) {
            items.push(text.trim());
          }
        }

        if (items.length > 0) {
          log(`🧩 Candidatos recolectados con selector ${selector}: ${items.length}`);
          return items;
        }
      }
    } catch {}
  }

  return [];
}

async function evaluateClasses(page) {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const cards = await collectCandidateCards(page);

  let notifications = [];

  for (const target of TARGET_CLASSES) {
    for (const hour of target.hours) {
      const matches = cards.filter(card => matchDay(card, target.day) && matchHour(card, hour));

      if (matches.length === 0) {
        if (matchDay(bodyText, target.day) && matchHour(bodyText, hour)) {
          if (hasAvailability(bodyText) && !looksLikeBooked(bodyText)) {
            notifications.push(`🔥 Cupo disponible: ${target.day} ${hour}`);
          }
        }
        continue;
      }

      for (const match of matches) {
        if (looksLikeBooked(match)) {
          log(`✅ Ya inscrito en ${target.day} ${hour}, no notifico`);
          continue;
        }

        if (hasAvailability(match)) {
          notifications.push(`🔥 Cupo disponible: ${target.day} ${hour}`);
          break;
        }
      }
    }
  }

  notifications = [...new Set(notifications)];
  return notifications;
}

async function runMonitor() {
  log("🚀 Monitor iniciado...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await gotoEntry(page);
    await doLoginIfNeeded(page);
    await goToSchedule(page);

    log("🔎 Revisando clases...");
    const notifications = await evaluateClasses(page);

    if (notifications.length === 0) {
      log("😴 Sin cupos en horarios objetivo");
    } else {
      for (const msg of notifications) {
        log(msg);
        await sendWhatsApp(msg);
      }
    }
  } catch (error) {
    log("❌ Error scraping:", error.message);
  } finally {
    await browser.close();
    log("🧹 Browser cerrado");
  }
}

runMonitor();
setInterval(runMonitor, CHECK_INTERVAL_MS);