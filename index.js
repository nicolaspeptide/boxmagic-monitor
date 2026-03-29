const { chromium } = require("playwright");
const twilio = require("twilio");

// ======================================================
// CONFIG
// ======================================================
const BOXMAGIC_ENTRY_URL =
  process.env.BOXMAGIC_ENTRY_URL ||
  "https://members.boxmagic.app/a/g/oGDPQaGLb5/perfil?o=a-iugpd";

const BOXMAGIC_EMAIL = process.env.BOXMAGIC_EMAIL || "";
const BOXMAGIC_PASSWORD = process.env.BOXMAGIC_PASSWORD || "";

const HEADLESS = (process.env.HEADLESS || "true").toLowerCase() !== "false";
const TIMEOUT = Number(process.env.TIMEOUT || 30000);

// Tus horarios fijos
const TARGET_SCHEDULE = {
  monday: [19, 20],
  tuesday: [19, 20],
  wednesday: [20],
  friday: [19],
};

// WhatsApp Twilio
const TWILIO_SID = process.env.TWILIO_SID || "";
const TWILIO_TOKEN = process.env.TWILIO_TOKEN || "";
const TWILIO_FROM = process.env.TWILIO_FROM || "";
const TWILIO_TO = process.env.TWILIO_TO || "";

const twilioEnabled =
  !!TWILIO_SID && !!TWILIO_TOKEN && !!TWILIO_FROM && !!TWILIO_TO;

const twilioClient = twilioEnabled
  ? twilio(TWILIO_SID, TWILIO_TOKEN)
  : null;

// ======================================================
// LOG
// ======================================================
function log(msg) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

// ======================================================
// HELPERS
// ======================================================
function normalizeText(text) {
  return (text || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lower(text) {
  return normalizeText(text).toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeInnerText(locator, timeout = 1200) {
  try {
    const txt = await locator.innerText({ timeout });
    return normalizeText(txt);
  } catch {
    return "";
  }
}

function weekdayAliases() {
  return {
    monday: ["mon", "monday", "lun", "lunes"],
    tuesday: ["tue", "tuesday", "mar", "martes"],
    wednesday: ["wed", "wednesday", "mie", "mié", "miercoles", "miércoles"],
    thursday: ["thu", "thursday", "jue", "jueves"],
    friday: ["fri", "friday", "vie", "viernes"],
    saturday: ["sat", "saturday", "sab", "sáb", "sabado", "sábado"],
    sunday: ["sun", "sunday", "dom", "domingo"],
  };
}

function matchesWeekday(text, weekday) {
  const low = lower(text);
  return (weekdayAliases()[weekday] || []).some((a) => low.includes(a));
}

function detectWeekday(text) {
  const low = lower(text);
  const map = weekdayAliases();

  for (const day of Object.keys(map)) {
    if (map[day].some((a) => low.includes(a))) {
      return day;
    }
  }

  return null;
}

function extractHours(text) {
  const low = lower(text);
  const hours = new Set();

  // ejemplos: 7:00pm, 8:00 pm, 19:00, 7pm to 8pm
  const regex =
    /(\b\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*(?:-|to|a)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/gi;

  let m;
  while ((m = regex.exec(low)) !== null) {
    let h1 = parseInt(m[1], 10);
    const ap1 = m[3];

    if (ap1 === "pm" && h1 < 12) h1 += 12;
    if (ap1 === "am" && h1 === 12) h1 = 0;

    if (!Number.isNaN(h1) && h1 >= 0 && h1 <= 23) {
      hours.add(h1);
    }
  }

  return Array.from(hours);
}

function textLooksLikeClassBlock(text) {
  const low = lower(text);

  const hasTime =
    /\b\d{1,2}:\d{2}\s*(am|pm)?\b/i.test(low) ||
    /\b\d{1,2}\s*(am|pm)\b/i.test(low);

  const hasClassWord = [
    "in person",
    "online",
    "entrenamiento",
    "session",
    "class",
    "scheduled",
    "personalizado",
  ].some((x) => low.includes(x));

  return hasTime || hasClassWord;
}

function isGlobalNoise(text) {
  const low = lower(text);

  return [
    "billing period",
    "tokens used",
    "scheduled tokens",
    "sessions",
    "my memberships",
    "membership",
    "renew plan",
    "settings",
    "store",
    "assessments",
    "show inactive",
    "active profile",
    "valid until",
    "maximum 1 session/day",
    "16 tokens/month",
    "14 tokens used",
    "11 sessions",
    "16 sessions",
  ].some((x) => low.includes(x));
}

function alreadyBooked(text) {
  const low = lower(text);

  return [
    "my reservation",
    "booked by you",
    "your reservation",
    "ya reservado",
    "reservado por ti",
    "mi reserva",
    "inscrito",
    "booked"
  ].some((x) => low.includes(x));
}

// ======================================================
// DISPONIBILIDAD ULTRA ESTRICTA
// ======================================================
function extractStrictAvailability(text) {
  const low = lower(text);

  // veto duro
  if (
    low.includes("full capacity") ||
    low.includes("capacidad completa") ||
    low.includes("sin cupos") ||
    low.includes("agotado") ||
    low.includes("sold out") ||
    low.includes("no classes scheduled today")
  ) {
    return {
      available: false,
      spots: 0,
      reason: "hard_negative",
    };
  }

  // positivos explícitos de verdad
  let m =
    low.match(/\b(\d{1,2})\s+available\s+space\b/i) ||
    low.match(/\b(\d{1,2})\s+available\s+spaces\b/i) ||
    low.match(/\b(\d{1,2})\s+spots?\s+available\b/i) ||
    low.match(/\b(\d{1,2})\s+cupos?\s+disponibles\b/i) ||
    low.match(/\bquedan\s+(\d{1,2})\s+cupos?\b/i);

  if (m) {
    const spots = parseInt(m[1], 10);
    return {
      available: !Number.isNaN(spots) && spots > 0,
      spots: Number.isNaN(spots) ? null : spots,
      reason: "explicit_positive_number",
    };
  }

  // fallback muy restringido:
  // "No one registered" + "X max" + NO full capacity
  const noOneRegistered = low.includes("no one registered");
  const maxMatch = low.match(/\b(\d{1,2})\s+max\b/i);

  if (noOneRegistered && maxMatch) {
    const max = parseInt(maxMatch[1], 10);
    if (!Number.isNaN(max) && max > 0) {
      return {
        available: true,
        spots: max,
        reason: "no_one_registered_plus_max",
      };
    }
  }

  return {
    available: null,
    spots: null,
    reason: "no_strict_signal",
  };
}

// ======================================================
// WHATSAPP
// ======================================================
async function sendWhatsAppAlert(message) {
  if (!twilioEnabled) {
    log("⚠️ WhatsApp desactivado");
    return;
  }

  await twilioClient.messages.create({
    from: TWILIO_FROM,
    to: TWILIO_TO,
    body: message,
  });

  log("✅ WhatsApp enviado");
}

// ======================================================
// LOGIN
// ======================================================
async function login(page) {
  log("🔐 Abriendo login...");
  await page.goto(BOXMAGIC_ENTRY_URL, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT,
  });

  await sleep(3000);

  const bodyText = await safeInnerText(page.locator("body"));
  log(`📝 Texto visible entry: ${bodyText.slice(0, 400)}`);

  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[placeholder*="mail" i]',
    'input[placeholder*="email" i]',
  ];

  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[placeholder*="password" i]',
    'input[placeholder*="contraseña" i]',
  ];

  let email = null;
  for (const sel of emailSelectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      email = loc;
      break;
    }
  }

  if (!email) throw new Error("No encontré el campo de email");

  let password = null;
  for (const sel of passwordSelectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      password = loc;
      break;
    }
  }

  if (!password) throw new Error("No encontré el campo de password");

  await email.fill(BOXMAGIC_EMAIL);
  await password.fill(BOXMAGIC_PASSWORD);

  const submitSelectors = [
    'button[type="submit"]',
    'button:has-text("Sign in")',
    'button:has-text("Entrar")',
    'button:has-text("Ingresar")',
    'button:has-text("Iniciar")',
  ];

  let submitted = false;
  for (const sel of submitSelectors) {
    const btn = page.locator(sel).first();
    if ((await btn.count()) > 0) {
      await btn.click();
      submitted = true;
      log(`✅ Submit login con: ${sel}`);
      break;
    }
  }

  if (!submitted) {
    await password.press("Enter");
    log("✅ Submit login con Enter");
  }

  await sleep(5000);

  const afterText = lower(await safeInnerText(page.locator("body")));
  if (afterText.includes("sign in to your account")) {
    throw new Error("Login no avanzó");
  }

  log("✅ Ya estoy en login");
}

// ======================================================
// NAVEGAR A HORARIOS
// ======================================================
async function goToSchedules(page) {
  log("📅 Buscando vista de horarios...");

  const selectors = [
    'a[href*="horarios"]',
    'a[href*="schedule"]',
    'a[href*="agenda"]',
    'a:has-text("Schedules")',
    'a:has-text("Schedule")',
    'a:has-text("Agenda")',
    'a:has-text("Horarios")',
    'button:has-text("Schedules")',
    'button:has-text("Agenda")',
    'button:has-text("Horarios")',
  ];

  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      await loc.click();
      await sleep(3500);
      log(`✅ Navegué a horarios con selector: ${sel}`);
      return;
    }
  }

  throw new Error("No pude abrir la vista de horarios");
}

// ======================================================
// TABS DE DÍAS
// ======================================================
async function getVisibleDayTabs(page) {
  const selectors = ["button", "[role='tab']", "a", "div", "span"];
  const out = [];

  for (const sel of selectors) {
    const loc = page.locator(sel);
    const count = await loc.count();

    for (let i = 0; i < Math.min(count, 250); i++) {
      const item = loc.nth(i);
      const text = await safeInnerText(item);
      if (!text) continue;

      if (
        /\b(mon|monday|lun|lunes|tue|tuesday|mar|martes|wed|wednesday|mie|mié|miercoles|miércoles|thu|thursday|jue|jueves|fri|friday|vie|viernes|sat|saturday|sab|sábado|sabado|sun|sunday|dom|domingo)\b/i.test(
          lower(text)
        )
      ) {
        out.push({ locator: item, text });
      }
    }
  }

  const uniq = [];
  const seen = new Set();

  for (const item of out) {
    const key = lower(item.text);
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(item);
    }
  }

  return uniq;
}

async function openTargetDay(page, weekday) {
  const tabs = await getVisibleDayTabs(page);

  log(`🧭 Tabs de días visibles: ${tabs.map((x) => x.text).join(" | ")}`);

  const target = tabs.find((t) => matchesWeekday(t.text, weekday));
  if (!target) {
    log(`⚪ No pude abrir tab para ${weekday}`);
    return false;
  }

  try {
    await target.locator.click();
    await sleep(2500);
    log(`✅ Día abierto: ${weekday} -> ${target.text}`);
    return true;
  } catch (e) {
    log(`⚪ Error abriendo tab ${weekday}: ${e.message}`);
    return false;
  }
}

// ======================================================
// BLOQUES REALES DE CLASE
// ======================================================
async function collectStrictSessionBlocks(page, weekday) {
  const selectors = [
    "article",
    "li",
    "[role='listitem']",
    ".card",
    ".session",
    ".class",
    "div",
  ];

  const candidates = [];

  for (const sel of selectors) {
    const loc = page.locator(sel);
    const count = await loc.count();

    for (let i = 0; i < Math.min(count, 500); i++) {
      const item = loc.nth(i);
      const text = await safeInnerText(item);

      if (!text) continue;
      if (text.length < 20) continue;
      if (isGlobalNoise(text)) continue;
      if (!textLooksLikeClassBlock(text)) continue;

      // Debe tener tiempo o formato real
      const hours = extractHours(text);
      if (hours.length === 0) continue;

      // No queremos bloques de perfil gigante
      if (text.length > 700) continue;

      // Si menciona weekday distinto, se descarta
      const detected = detectWeekday(text);
      if (detected && detected !== weekday) continue;

      candidates.push({
        selector: sel,
        text,
      });
    }
  }

  const dedup = [];
  const seen = new Set();

  for (const c of candidates) {
    const key = lower(c.text);
    if (!seen.has(key)) {
      seen.add(key);
      dedup.push(c);
    }
  }

  return dedup;
}

// ======================================================
// PARSEO ESTRICTO
// ======================================================
function parseStrictCandidate(text, weekday, targetHours) {
  const hours = extractHours(text);
  const availability = extractStrictAvailability(text);
  const booked = alreadyBooked(text);

  const hourMatch = hours.some((h) => targetHours.includes(h));

  return {
    weekday,
    hours,
    hourMatch,
    availability,
    alreadyBooked: booked,
    text,
  };
}

// ======================================================
// REVIEW DÍA POR DÍA
// ======================================================
async function reviewDayByDay(page) {
  const alerts = [];

  for (const [weekday, targetHours] of Object.entries(TARGET_SCHEDULE)) {
    log(`📅 Día: ${weekday}`);
    log(`🕒 Hora(s): ${targetHours.join(", ")}`);

    const opened = await openTargetDay(page, weekday);
    if (!opened) continue;

    const visible = await safeInnerText(page.locator("body"));
    log(`📝 Texto visible ${weekday}: ${visible.slice(0, 250)}`);

    const blocks = await collectStrictSessionBlocks(page, weekday);
    log(`🧩 Bloques sesión ${weekday}: ${blocks.length}`);

    for (const b of blocks) {
      const parsed = parseStrictCandidate(b.text, weekday, targetHours);

      log(
        `📌 CANDIDATO ${weekday}: ${JSON.stringify({
          hours: parsed.hours,
          availability: parsed.availability,
          alreadyBooked: parsed.alreadyBooked,
          text: parsed.text.slice(0, 200),
        })}`
      );

      if (!parsed.hourMatch) continue;
      if (parsed.alreadyBooked) continue;
      if (parsed.availability.available !== true) continue;
      if (parsed.availability.reason === "hard_negative") continue;

      alerts.push(parsed);
    }
  }

  if (alerts.length === 0) {
    log("⚪ No encontré clases en horarios objetivo");
    return;
  }

  const lines = ["🚨 Boxmagic", "Hay cupo en una clase objetivo.", ""];

  for (const a of alerts) {
    lines.push(`📅 Día: ${a.weekday}`);
    lines.push(`🕒 Hora(s): ${a.hours.join(", ") || "?"}`);
    lines.push(`👥 Cupos: ${a.availability.spots ?? "?"}`);
    lines.push(`📝 ${a.text.slice(0, 180)}`);
    lines.push("");
  }

  const message = lines.join("\n");

  log(`📣 AVISAR: ${message}`);
  await sendWhatsAppAlert(message);
}

// ======================================================
// MAIN
// ======================================================
async function main() {
  let browser;

  try {
    log("🚀 Monitor iniciado...");
    browser = await chromium.launch({
      headless: HEADLESS,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    await login(page);
    await goToSchedules(page);
    await reviewDayByDay(page);

    log("🟢 Proceso completado");
  } catch (error) {
    log(`❌ Error scraping: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
      log("🧹 Browser cerrado");
    }
  }
}

main();