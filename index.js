const { chromium } = require("playwright");
const twilio = require("twilio");

// =========================
// CONFIG
// =========================
const BOXMAGIC_ENTRY_URL =
  process.env.BOXMAGIC_ENTRY_URL ||
  "https://members.boxmagic.app/a/g/oGDPQaGLb5/perfil?o=a-iugpd";

const BOXMAGIC_EMAIL = process.env.BOXMAGIC_EMAIL || "";
const BOXMAGIC_PASSWORD = process.env.BOXMAGIC_PASSWORD || "";

const HEADLESS = (process.env.HEADLESS || "true").toLowerCase() !== "false";
const TIMEOUT = Number(process.env.TIMEOUT || 30000);

const TARGET_SCHEDULE = {
  monday: [19, 20],
  tuesday: [19, 20],
  wednesday: [20],
  friday: [19],
};

const TWILIO_SID = process.env.TWILIO_SID || "";
const TWILIO_TOKEN = process.env.TWILIO_TOKEN || "";
const TWILIO_FROM = process.env.TWILIO_FROM || "";
const TWILIO_TO = process.env.TWILIO_TO || "";

const twilioEnabled =
  !!TWILIO_SID && !!TWILIO_TOKEN && !!TWILIO_FROM && !!TWILIO_TO;

const twilioClient = twilioEnabled
  ? twilio(TWILIO_SID, TWILIO_TOKEN)
  : null;

// =========================
// LOG
// =========================
function log(msg) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

// =========================
// HELPERS
// =========================
function normalizeText(text) {
  return (text || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLower(text) {
  return normalizeText(text).toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkText(text) {
  return normalizeText(text)
    .split(/(?:(?:\s{2,})|\n+)/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function getWeekdayAliases() {
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

function weekdayMatches(text, weekday) {
  const aliases = getWeekdayAliases()[weekday] || [];
  const low = cleanLower(text);
  return aliases.some((a) => low.includes(a));
}

function detectWeekdayFromText(text) {
  const low = cleanLower(text);
  const aliases = getWeekdayAliases();

  for (const weekday of Object.keys(aliases)) {
    if (aliases[weekday].some((a) => low.includes(a))) {
      return weekday;
    }
  }
  return null;
}

function extractHours(text) {
  const low = cleanLower(text);
  const found = new Set();

  // 7:00pm, 8:00pm, 19:00, etc.
  const regex =
    /(\b\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|a)?\s*(\d{1,2})?(?::(\d{2}))?\s*(am|pm)?/gi;

  let m;
  while ((m = regex.exec(low)) !== null) {
    let hour1 = parseInt(m[1], 10);
    const ampm1 = m[3];

    if (ampm1 === "pm" && hour1 < 12) hour1 += 12;
    if (ampm1 === "am" && hour1 === 12) hour1 = 0;

    if (!Number.isNaN(hour1) && hour1 >= 0 && hour1 <= 23) {
      found.add(hour1);
    }
  }

  // fallback: buscar horas enteras razonables
  const rough = low.match(/\b([01]?\d|2[0-3])\b/g) || [];
  for (const h of rough) {
    const n = parseInt(h, 10);
    if (n >= 6 && n <= 22) found.add(n);
  }

  return Array.from(found);
}

function alreadyBookedFromText(text) {
  const low = cleanLower(text);

  // si aparece "next scheduled session" o "scheduled" del perfil, no lo usamos como booked real de tarjeta
  // aquí solo queremos booked si el bloque mismo lo sugiere
  const bookedSignals = [
    "booked",
    "reserved",
    "inscrito",
    "reservado",
    "agendado",
    "mi reserva",
    "my reservation",
  ];

  return bookedSignals.some((s) => low.includes(s));
}

function extractAvailability(text) {
  const low = cleanLower(text);

  // veto duro
  if (
    low.includes("full capacity") ||
    low.includes("capacidad completa") ||
    low.includes("sin cupos") ||
    low.includes("agotado") ||
    low.includes("sold out")
  ) {
    return {
      available: false,
      spots: 0,
      reason: "full_capacity",
    };
  }

  // señales explícitas positivas
  const positivePatterns = [
    /\b(\d{1,2})\s+available\s+space\b/i,
    /\b(\d{1,2})\s+available\s+spaces\b/i,
    /\b(\d{1,2})\s+spots?\s+available\b/i,
    /\bquedan\s+(\d{1,2})\s+cupos?\b/i,
    /\b(\d{1,2})\s+cupos?\s+disponibles\b/i,
    /\bavailable\s+space\b/i,
    /\bavailable\s+spaces\b/i,
    /\bspot\s+available\b/i,
    /\bspots\s+available\b/i,
    /\bcupos?\s+disponibles\b/i,
  ];

  for (const pattern of positivePatterns) {
    const m = low.match(pattern);
    if (m) {
      const spots = m[1] ? parseInt(m[1], 10) : 1;
      return {
        available: true,
        spots: Number.isNaN(spots) ? 1 : spots,
        reason: "explicit_available",
      };
    }
  }

  // "No one registered" NO significa automáticamente cupo útil, pero puede ser pista si además aparece max
  const mNoOne = low.includes("no one registered");
  const mMax = low.match(/\b(\d{1,2})\s+max\b/i);

  if (mNoOne && mMax) {
    const max = parseInt(mMax[1], 10);
    if (!Number.isNaN(max) && max > 0) {
      return {
        available: true,
        spots: max,
        reason: "no_one_registered_with_max",
      };
    }
  }

  return {
    available: null,
    spots: null,
    reason: "unknown",
  };
}

function textLooksLikeRealClass(text) {
  const low = cleanLower(text);

  const timeish =
    /\b\d{1,2}:\d{2}\s*(am|pm)?\b/i.test(low) ||
    /\b\d{1,2}\s*(am|pm)\b/i.test(low);

  const classishSignals = [
    "in person",
    "online",
    "entrenamiento",
    "class",
    "session",
    "scheduled",
    "personalizado",
  ];

  const hasClassish = classishSignals.some((s) => low.includes(s));

  return timeish || hasClassish;
}

function isNoiseText(text) {
  const low = cleanLower(text);

  const noiseSignals = [
    "billing period",
    "tokens used",
    "scheduled tokens",
    "sessions",
    "active profile",
    "membership",
    "my memberships",
    "renew plan",
    "maximum 1 session/day",
    "valid until",
    "settings",
    "store",
    "assessments",
    "see all",
    "show inactive",
  ];

  return noiseSignals.some((s) => low.includes(s));
}

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

async function safeInnerText(locator) {
  try {
    const txt = await locator.innerText({ timeout: 1500 });
    return normalizeText(txt);
  } catch {
    return "";
  }
}

// =========================
// LOGIN
// =========================
async function login(page) {
  log("🔐 Abriendo login...");
  await page.goto(BOXMAGIC_ENTRY_URL, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT,
  });

  await sleep(2500);

  const bodyText = cleanLower(await page.locator("body").innerText());
  log(`📝 Texto visible entry: ${bodyText.slice(0, 500)}`);

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

  let emailLocator = null;
  for (const sel of emailSelectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      emailLocator = loc;
      break;
    }
  }

  if (!emailLocator) {
    throw new Error("No encontré el campo de email");
  }

  let passwordLocator = null;
  for (const sel of passwordSelectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      passwordLocator = loc;
      break;
    }
  }

  if (!passwordLocator) {
    throw new Error("No encontré el campo de password");
  }

  await emailLocator.fill(BOXMAGIC_EMAIL);
  await passwordLocator.fill(BOXMAGIC_PASSWORD);

  const submitSelectors = [
    'button[type="submit"]',
    'button:has-text("Sign in")',
    'button:has-text("Iniciar")',
    'button:has-text("Ingresar")',
    'button:has-text("Entrar")',
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
    await passwordLocator.press("Enter");
    log("✅ Submit login con Enter");
  }

  await sleep(5000);

  const afterText = cleanLower(await page.locator("body").innerText());
  if (afterText.includes("sign in to your account")) {
    throw new Error("Login no avanzó");
  }

  log("✅ Ya estoy en login/post-login");
}

// =========================
// IR A HORARIOS
// =========================
async function goToSchedules(page) {
  log("📅 Buscando vista de horarios...");

  const hrefHorarios = page.locator('a[href*="horarios"]').first();
  if ((await hrefHorarios.count()) > 0) {
    await hrefHorarios.click();
    await sleep(3000);
    log('✅ Navegué a horarios con selector: a[href*="horarios"]');
    return;
  }

  const hrefSchedules = page.locator('a[href*="schedule"], a[href*="agenda"]').first();
  if ((await hrefSchedules.count()) > 0) {
    await hrefSchedules.click();
    await sleep(3000);
    log('✅ Navegué a horarios con selector: a[href*="schedule"], a[href*="agenda"]');
    return;
  }

  const textSelectors = [
    'a:has-text("Schedules")',
    'a:has-text("Schedule")',
    'a:has-text("Agenda")',
    'a:has-text("Horarios")',
    'button:has-text("Schedules")',
    'button:has-text("Agenda")',
    'button:has-text("Horarios")',
  ];

  for (const sel of textSelectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0) {
      await loc.click();
      await sleep(3000);
      log(`✅ Navegué a horarios con selector: ${sel}`);
      return;
    }
  }

  throw new Error("No pude abrir la vista de horarios");
}

// =========================
// DÍAS / BLOQUES
// =========================
async function getVisibleDayTabs(page) {
  const tabSelectors = [
    "button",
    "[role='tab']",
    "a",
    "div",
    "span",
  ];

  const results = [];

  for (const sel of tabSelectors) {
    const loc = page.locator(sel);
    const count = await loc.count();

    for (let i = 0; i < Math.min(count, 300); i++) {
      const item = loc.nth(i);
      const text = await safeInnerText(item);
      if (!text) continue;

      const low = cleanLower(text);

      const looksDay =
        /\b(mon|monday|lun|lunes)\b/i.test(low) ||
        /\b(tue|tuesday|mar|martes)\b/i.test(low) ||
        /\b(wed|wednesday|mie|mié|miércoles|miercoles)\b/i.test(low) ||
        /\b(thu|thursday|jue|jueves)\b/i.test(low) ||
        /\b(fri|friday|vie|viernes)\b/i.test(low) ||
        /\b(sat|saturday|sab|sábado|sabado)\b/i.test(low) ||
        /\b(sun|sunday|dom|domingo)\b/i.test(low);

      if (looksDay) {
        results.push({ locator: item, text });
      }
    }
  }

  const unique = [];
  const seen = new Set();

  for (const x of results) {
    const key = cleanLower(x.text);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(x);
    }
  }

  return unique;
}

async function openTargetDay(page, weekday) {
  const tabs = await getVisibleDayTabs(page);

  log(`🧭 Tabs de días visibles: ${tabs.map((t) => t.text).join(" | ")}`);

  const target = tabs.find((t) => weekdayMatches(t.text, weekday));

  if (!target) {
    log(`⚪ No pude abrir tab para ${weekday}`);
    return false;
  }

  try {
    await target.locator.click();
    await sleep(2500);
    log(`✅ Día abierto por estructura: ${weekday} -> ${target.text}`);
    return true;
  } catch (e) {
    log(`⚪ Falló click tab ${weekday}: ${e.message}`);
    return false;
  }
}

async function collectRealSessionBlocks(page) {
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
      if (isNoiseText(text)) continue;
      if (!textLooksLikeRealClass(text)) continue;

      candidates.push({
        selector: sel,
        text,
      });
    }
  }

  const dedup = [];
  const seen = new Set();

  for (const c of candidates) {
    const key = cleanLower(c.text);
    if (!seen.has(key)) {
      seen.add(key);
      dedup.push(c);
    }
  }

  return dedup;
}

// =========================
// PARSER DE CLASES
// =========================
function classLooksTarget(candidateText, weekday, targetHours) {
  const low = cleanLower(candidateText);
  const hours = extractHours(candidateText);

  const weekdayDetected = detectWeekdayFromText(candidateText);
  const weekdayOk =
    !weekdayDetected || weekdayDetected === weekday || weekdayMatches(candidateText, weekday);

  const hourOk = hours.some((h) => targetHours.includes(h));

  return {
    weekdayDetected,
    hours,
    weekdayOk,
    hourOk,
    ok: weekdayOk && hourOk,
  };
}

function parseCandidate(candidateText, weekday, targetHours) {
  const availability = extractAvailability(candidateText);
  const booked = alreadyBookedFromText(candidateText);
  const target = classLooksTarget(candidateText, weekday, targetHours);

  return {
    weekday,
    hours: target.hours,
    availability,
    alreadyBooked: booked,
    targetMatch: target.ok,
    text: candidateText,
  };
}

// =========================
// REVIEW DÍA POR DÍA
// =========================
async function reviewClassesDayByDay(page) {
  const alerts = [];

  for (const [weekday, targetHours] of Object.entries(TARGET_SCHEDULE)) {
    log(`📆 Día: ${weekday}`);
    log(`🕒 Hora(s): ${targetHours.join(", ")}`);

    const opened = await openTargetDay(page, weekday);
    if (!opened) {
      continue;
    }

    const visibleText = normalizeText(await page.locator("body").innerText());
    log(`📝 Texto visible ${weekday}: ${visibleText.slice(0, 300)}`);

    const candidates = await collectRealSessionBlocks(page);
    log(`🧩 Candidatos DOM recolectados: ${candidates.length}`);

    const parsed = candidates.map((c) => parseCandidate(c.text, weekday, targetHours));

    let matched = 0;

    for (const p of parsed) {
      if (!p.targetMatch) continue;
      matched++;

      log(
        `📌 CANDIDATO ${weekday}: ${JSON.stringify({
          weekday: p.weekday,
          hours: p.hours,
          availability: p.availability,
          alreadyBooked: p.alreadyBooked,
          text: p.text.slice(0, 220),
        })}`
      );

      // veto duro
      if (p.availability.reason === "full_capacity") {
        log(`⛔ Descartado por capacidad completa: ${weekday}`);
        continue;
      }

      if (p.alreadyBooked) {
        log(`ℹ️ Ya reservada / booked: ${weekday}`);
        continue;
      }

      if (p.availability.available === true) {
        alerts.push(p);
      }
    }

    log(`📊 Bloques sesión ${weekday}: ${matched}`);
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

// =========================
// MAIN
// =========================
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
    await reviewClassesDayByDay(page);

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