import { chromium } from "playwright";
import twilio from "twilio";

const {
  BOXMAGIC_EMAIL,
  BOXMAGIC_PASSWORD,
  BOXMAGIC_ENTRY_URL,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  TWILIO_WHATSAPP_TO,
} = process.env;

const TARGET_SLOTS = [
  { weekday: "monday", hours: [19, 20] },
  { weekday: "tuesday", hours: [19, 20] },
  { weekday: "wednesday", hours: [20] },
  { weekday: "friday", hours: [19] },
];

const DEBUG = true;

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(text = "") {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function safeText(text = "") {
  return (text || "").replace(/\s+/g, " ").trim();
}

function stripHtml(html = "") {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHourCandidates(text) {
  const normalized = normalizeText(text);
  const results = new Set();

  const hourRegexes = [
    /\b([01]?\d|2[0-3])[:.](\d{2})\s*(am|pm)?\b/g,
    /\b([01]?\d|2[0-3])\s*(am|pm)\b/g,
    /\b([01]?\d|2[0-3])h\b/g,
  ];

  for (const regex of hourRegexes) {
    let match;
    while ((match = regex.exec(normalized)) !== null) {
      if (regex.source.includes("[:.]")) {
        let hour = parseInt(match[1], 10);
        const suffix = match[3];
        if (suffix === "pm" && hour < 12) hour += 12;
        if (suffix === "am" && hour === 12) hour = 0;
        results.add(hour);
      } else if (regex.source.includes("(am|pm)")) {
        let hour = parseInt(match[1], 10);
        const suffix = match[2];
        if (suffix === "pm" && hour < 12) hour += 12;
        if (suffix === "am" && hour === 12) hour = 0;
        results.add(hour);
      } else {
        results.add(parseInt(match[1], 10));
      }
    }
  }

  return [...results].filter((n) => Number.isInteger(n) && n >= 0 && n <= 23);
}

function parseWeekday(text) {
  const t = normalizeText(text);

  const map = [
    { keys: ["monday", "mon", "lunes"], value: "monday" },
    { keys: ["tuesday", "tue", "martes"], value: "tuesday" },
    { keys: ["wednesday", "wed", "miercoles", "miércoles"], value: "wednesday" },
    { keys: ["thursday", "thu", "jueves"], value: "thursday" },
    { keys: ["friday", "fri", "viernes"], value: "friday" },
    { keys: ["saturday", "sat", "sabado", "sábado"], value: "saturday" },
    { keys: ["sunday", "sun", "domingo"], value: "sunday" },
  ];

  for (const item of map) {
    if (item.keys.some((k) => t.includes(normalizeText(k)))) {
      return item.value;
    }
  }

  return null;
}

function parseAvailability(text) {
  const t = normalizeText(text);

  if (t.includes("full capacity") || t.includes("capacidad completa")) {
    return { available: false, spots: 0, reason: "full_capacity" };
  }

  if (t.includes("no one registered") || t.includes("nadie inscrito")) {
    return { available: true, spots: 999, reason: "empty_class" };
  }

  if (t.includes("available") || t.includes("disponible") || t.includes("spaces")) {
    const nums = [...t.matchAll(/\b(\d{1,2})\b/g)].map((m) => parseInt(m[1], 10));
    if (nums.length > 0) {
      const max = Math.max(...nums);
      if (max > 0) {
        return { available: true, spots: max, reason: "numeric_available" };
      }
    }
  }

  // En Boxmagic a veces aparece solo un número suelto cerca del bloque
  const rawNums = [...t.matchAll(/\b(\d{1,2})\b/g)].map((m) => parseInt(m[1], 10));
  const plausible = rawNums.filter((n) => n >= 1 && n <= 12);
  if (plausible.length > 0) {
    const max = Math.max(...plausible);
    return { available: true, spots: max, reason: "plausible_numeric" };
  }

  return { available: false, spots: 0, reason: "unknown" };
}

function detectAlreadyBooked(text) {
  const t = normalizeText(text);
  const patterns = [
    "you are registered",
    "registered",
    "booked",
    "reserved",
    "inscrito",
    "reservado",
    "tu reserva",
    "mi reserva",
    "cancel reservation",
    "cancel booking",
    "ver reserva",
    "see agenda",
    "find your reservations in your agenda",
  ];

  return patterns.some((p) => t.includes(normalizeText(p)));
}

function isTargetSlot(weekday, hourCandidates) {
  if (!weekday || !hourCandidates?.length) return false;

  for (const target of TARGET_SLOTS) {
    if (target.weekday !== weekday) continue;
    for (const h of hourCandidates) {
      if (target.hours.includes(h)) return true;
    }
  }
  return false;
}

function summarizeCandidate(candidate) {
  return {
    weekday: candidate.weekday,
    hours: candidate.hourCandidates,
    availability: candidate.availability,
    alreadyBooked: candidate.alreadyBooked,
    text: candidate.text.slice(0, 240),
  };
}

async function sendWhatsApp(message) {
  if (
    !TWILIO_ACCOUNT_SID ||
    !TWILIO_AUTH_TOKEN ||
    !TWILIO_WHATSAPP_FROM ||
    !TWILIO_WHATSAPP_TO
  ) {
    log("⚠️ Twilio no configurado. No envío WhatsApp.");
    return;
  }

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  await client.messages.create({
    from: TWILIO_WHATSAPP_FROM,
    to: TWILIO_WHATSAPP_TO,
    body: message,
  });

  log("✅ WhatsApp enviado");
}

async function getVisibleText(page) {
  const body = await page.locator("body").innerText().catch(() => "");
  return safeText(body);
}

async function findLoginAndAuthenticate(page) {
  log("🔐 Abriendo login...");
  await page.goto(BOXMAGIC_ENTRY_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(4000);

  log(`🌐 URL actual: ${page.url()}`);
  const firstText = await getVisibleText(page);
  log(`🧾 Texto visible entry: ${firstText.slice(0, 800)}`);

  const emailSelectors = [
    'input[type="email"]',
    'input[name*="email" i]',
    'input[placeholder*="email" i]',
    'input[autocomplete="email"]',
  ];

  const passwordSelectors = [
    'input[type="password"]',
    'input[name*="password" i]',
    'input[placeholder*="password" i]',
    'input[autocomplete="current-password"]',
  ];

  let emailInput = null;
  let passwordInput = null;

  for (const sel of emailSelectors) {
    const locator = page.locator(sel).first();
    if (await locator.count()) {
      emailInput = locator;
      log(`✅ Campo email encontrado: ${sel}`);
      break;
    }
  }

  for (const sel of passwordSelectors) {
    const locator = page.locator(sel).first();
    if (await locator.count()) {
      passwordInput = locator;
      log(`✅ Campo password encontrado: ${sel}`);
      break;
    }
  }

  if (!emailInput) {
    throw new Error(`No encontré el campo de email. URL actual: ${page.url()}`);
  }
  if (!passwordInput) {
    throw new Error(`No encontré el campo de password. URL actual: ${page.url()}`);
  }

  await emailInput.fill(BOXMAGIC_EMAIL);
  await passwordInput.fill(BOXMAGIC_PASSWORD);

  const submitCandidates = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Sign in")',
    'button:has-text("Ingresar")',
    'button:has-text("Entrar")',
    'button:has-text("Iniciar sesión")',
    'button:has-text("Login")',
  ];

  let submitted = false;
  for (const sel of submitCandidates) {
    const locator = page.locator(sel).first();
    if (await locator.count()) {
      log(`✅ Submit login con: ${sel}`);
      await Promise.allSettled([
        page.waitForLoadState("networkidle", { timeout: 20000 }),
        locator.click(),
      ]);
      submitted = true;
      break;
    }
  }

  if (!submitted) {
    await passwordInput.press("Enter");
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    log("✅ Submit login con Enter");
  }

  await page.waitForTimeout(5000);

  log(`🌐 URL post-login: ${page.url()}`);
  const postLoginText = await getVisibleText(page);
  log(`🧾 Texto visible post-login: ${postLoginText.slice(0, 1200)}`);

  if (
    normalizeText(postLoginText).includes("sign in") &&
    normalizeText(postLoginText).includes("password")
  ) {
    throw new Error("Login parece no haberse completado");
  }
}

async function navigateToSchedule(page) {
  log("📆 Buscando vista de horarios...");

  const agendaTexts = [
    "agenda",
    "schedules",
    "schedule",
    "horarios",
    "reservations",
    "see agenda",
  ];

  for (const txt of agendaTexts) {
    const locator = page.locator(`text=/^.*${txt}.*$/i`).first();
    if (await locator.count()) {
      log(`✅ Navegué a horarios con: text=/${txt}/i`);
      await Promise.allSettled([
        page.waitForLoadState("networkidle", { timeout: 20000 }),
        locator.click(),
      ]);
      await page.waitForTimeout(4000);
      break;
    }
  }

  const url = page.url();
  log(`🌐 URL horarios: ${url}`);

  const text = await getVisibleText(page);
  log(`🧾 Texto visible horarios: ${text.slice(0, 2000)}`);

  if (!text) {
    throw new Error("No pude leer contenido de la vista de horarios");
  }
}

async function collectCandidates(page) {
  log("🔎 Revisando clases...");

  const candidates = await page.evaluate(() => {
    function clean(text) {
      return (text || "").replace(/\s+/g, " ").trim();
    }

    const elements = [...document.querySelectorAll("div, article, section, li, button, a")]
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: clean(el.innerText || ""),
        html: el.innerHTML || "",
      }))
      .filter((x) => x.text.length >= 20 && x.text.length <= 1200);

    return elements;
  });

  log(`🧩 Candidatos recolectados: ${candidates.length}`);

  return candidates
    .map((item) => {
      const mergedText = `${item.text} ${stripHtml(item.html)}`.trim();
      const weekday = parseWeekday(mergedText);
      const hourCandidates = parseHourCandidates(mergedText);
      const availability = parseAvailability(mergedText);
      const alreadyBooked = detectAlreadyBooked(mergedText);

      return {
        rawTag: item.tag,
        text: safeText(mergedText),
        weekday,
        hourCandidates,
        availability,
        alreadyBooked,
        targetMatch: isTargetSlot(weekday, hourCandidates),
      };
    })
    .filter((x) => x.weekday || x.hourCandidates.length || x.availability.reason !== "unknown");
}

function pickBestMatches(candidates) {
  const filtered = candidates.filter((c) => c.targetMatch);

  // Deduplicación gruesa por texto
  const seen = new Set();
  const unique = [];
  for (const c of filtered) {
    const key = normalizeText(c.text).slice(0, 300);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }

  return unique;
}

function buildAlertMessage(matches) {
  const lines = [
    "🔥 Cupo disponible en Boxmagic",
    "",
  ];

  for (const m of matches) {
    lines.push(
      `• ${m.weekday} | horas: ${m.hourCandidates.join(", ")} | cupos: ${
        m.availability.spots === 999 ? "vacía" : m.availability.spots
      }`
    );
  }

  lines.push("", "Entra a Boxmagic y reserva.");
  return lines.join("\n");
}

async function main() {
  if (!BOXMAGIC_EMAIL || !BOXMAGIC_PASSWORD || !BOXMAGIC_ENTRY_URL) {
    throw new Error("Faltan variables BOXMAGIC_EMAIL, BOXMAGIC_PASSWORD o BOXMAGIC_ENTRY_URL");
  }

  let browser;
  let context;
  let page;

  try {
    log("🚀 Monitor iniciado...");

    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    context = await browser.newContext({
      viewport: { width: 1440, height: 2200 },
    });

    page = await context.newPage();

    await findLoginAndAuthenticate(page);
    await navigateToSchedule(page);

    const candidates = await collectCandidates(page);

    if (DEBUG) {
      for (const c of candidates.slice(0, 60)) {
        log(`📌 CANDIDATO: ${JSON.stringify(summarizeCandidate(c))}`);
      }
    }

    const matches = pickBestMatches(candidates);

    if (!matches.length) {
      log("⚠️ Sin cupos en horarios objetivo");
      return;
    }

    const availableNotBooked = matches.filter(
      (m) => m.availability.available && !m.alreadyBooked
    );

    if (!availableNotBooked.length) {
      log("ℹ️ Se detectaron horarios objetivo, pero sin cupo útil o ya inscrito");
      for (const m of matches) {
        log(`🧾 MATCH: ${JSON.stringify(summarizeCandidate(m))}`);
      }
      return;
    }

    for (const m of availableNotBooked) {
      log(`✅ MATCH DISPONIBLE: ${JSON.stringify(summarizeCandidate(m))}`);
    }

    const message = buildAlertMessage(availableNotBooked);
    await sendWhatsApp(message);
  } catch (error) {
    log(`❌ Error scraping: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
  } finally {
    try {
      if (browser) {
        await browser.close();
        log("🧹 Browser cerrado");
      }
    } catch {
      // ignore
    }
  }
}

main();