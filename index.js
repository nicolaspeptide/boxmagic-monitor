import { chromium } from "playwright";
import twilio from "twilio";

const CONFIG = {
  entryUrl:
    process.env.BOXMAGIC_ENTRY_URL ||
    "https://members.boxmagic.app/a/g/oGDPQaGLb5/perfil?o=a-iugpd",

  email: process.env.BOXMAGIC_EMAIL,
  password: process.env.BOXMAGIC_PASSWORD,

  whatsappEnabled:
    String(process.env.WHATSAPP_ENABLED || "false").toLowerCase() === "true",

  twilioSid: process.env.TWILIO_ACCOUNT_SID,
  twilioToken: process.env.TWILIO_AUTH_TOKEN,
  twilioFrom: process.env.TWILIO_WHATSAPP_FROM, // ej: whatsapp:+14155238886
  whatsappTo: process.env.WHATSAPP_TO, // ej: whatsapp:+569XXXXXXXX

  headless: true,
  slowMo: 0,
  timeoutMs: 30000,
};

const PREFERRED_SLOTS = [
  { weekday: "monday", hours: [19, 20] },
  { weekday: "tuesday", hours: [19, 20] },
  { weekday: "wednesday", hours: [20] },
  { weekday: "friday", hours: [19] },
];

const WEEKDAY_MAP = {
  lunes: "monday",
  monday: "monday",
  martes: "tuesday",
  tuesday: "tuesday",
  miércoles: "wednesday",
  miercoles: "wednesday",
  wednesday: "wednesday",
  jueves: "thursday",
  thursday: "thursday",
  viernes: "friday",
  friday: "friday",
  sábado: "saturday",
  sabado: "saturday",
  saturday: "saturday",
  domingo: "sunday",
  sunday: "sunday",
};

function log(msg) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

function cleanText(text = "") {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function uniqueStrings(arr) {
  return [...new Set(arr.map((x) => cleanText(x)).filter(Boolean))];
}

function normalizeForCompare(text = "") {
  return cleanText(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function containsAny(text, needles) {
  const t = normalizeForCompare(text);
  return needles.some((n) => t.includes(normalizeForCompare(n)));
}

function extractWeekday(text) {
  const t = normalizeForCompare(text);

  for (const [raw, normalized] of Object.entries(WEEKDAY_MAP)) {
    if (t.includes(normalizeForCompare(raw))) return normalized;
  }

  if (t.includes("tomorrow")) {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);

    const weekdays = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    return weekdays[tomorrow.getDay()];
  }

  if (t.includes("today")) {
    const now = new Date();
    const weekdays = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    return weekdays[now.getDay()];
  }

  return null;
}

function parseHourToken(token, ampm = null) {
  const match = token.match(/(\d{1,2})(?::(\d{2}))?/);
  if (!match) return null;

  let hour = Number(match[1]);

  const suffix = ampm ? ampm.toLowerCase() : null;

  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;

  return hour;
}

function extractHours(text) {
  const t = normalizeForCompare(text);
  const hours = [];

  // 7:00pm to 8:00pm / 7pm - 8pm
  const rangeRegex =
    /(\d{1,2}(?::\d{2})?)\s*(am|pm)?\s*(?:to|-|a)\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)?/gi;

  let rangeMatch;
  while ((rangeMatch = rangeRegex.exec(t)) !== null) {
    const startHour = parseHourToken(rangeMatch[1], rangeMatch[2] || rangeMatch[4] || null);
    if (startHour !== null) hours.push(startHour);
  }

  // 19h / 20h
  const hourHRegex = /\b(\d{1,2})\s*h\b/gi;
  let hMatch;
  while ((hMatch = hourHRegex.exec(t)) !== null) {
    const hr = Number(hMatch[1]);
    if (!Number.isNaN(hr)) hours.push(hr);
  }

  return [...new Set(hours)];
}

function extractSpots(text) {
  const t = normalizeForCompare(text);

  if (
    t.includes("full capacity") ||
    t.includes("capacidad completa") ||
    t.includes("completo") ||
    t.includes("sold out")
  ) {
    return { available: false, spots: 0, reason: "full_capacity" };
  }

  let match =
    t.match(/\b(\d{1,3})\s+(?:spots?|cupos?|spaces?)\s+(?:available|disponibles?)\b/i) ||
    t.match(/\bavailable[:\s]+(\d{1,3})\b/i) ||
    t.match(/\bdisponibles?[:\s]+(\d{1,3})\b/i) ||
    t.match(/\b(\d{1,3})\s+available\b/i);

  if (match) {
    const spots = Number(match[1]);
    return { available: spots > 0, spots, reason: "explicit_available" };
  }

  if (t.includes("no one registered")) {
    return { available: true, spots: 999, reason: "empty_class" };
  }

  match = t.match(/\b(\d{1,3})\s+max\b/i);
  if (match) {
    const max = Number(match[1]);
    if (max > 0 && !t.includes("full capacity")) {
      return { available: true, spots: max, reason: "plausible_numeric" };
    }
  }

  return { available: null, spots: null, reason: "unknown" };
}

function detectAlreadyBooked(text) {
  const t = normalizeForCompare(text);

  const bookedSignals = [
    "scheduled by",
    "next scheduled session",
    "your reservations",
    "find your reservations in your agenda",
    "mi agenda",
    "mis reservas",
    "reservado",
    "booked",
    "scheduled session",
  ];

  return bookedSignals.some((s) => t.includes(normalizeForCompare(s)));
}

function isLikelyClassCard(text) {
  const t = normalizeForCompare(text);

  const hasTimeRange =
    /(\d{1,2}(?::\d{2})?\s*(am|pm)?\s*(to|-|a)\s*\d{1,2}(?::\d{2})?\s*(am|pm)?)/i.test(t);

  const hasScheduleWords =
    containsAny(t, [
      "schedule",
      "schedules",
      "agenda",
      "in person",
      "registered",
      "full capacity",
      "capacidad completa",
      "max",
      "members",
      "available",
      "disponible",
      "disponibles",
      "session",
      "sesion",
      "sesión",
      "entrenamiento",
    ]);

  return hasTimeRange && hasScheduleWords;
}

function parseCandidate(rawText) {
  const text = cleanText(rawText);
  const weekday = extractWeekday(text);
  const hours = extractHours(text);
  const availability = extractSpots(text);
  const alreadyBooked = detectAlreadyBooked(text);

  return {
    weekday,
    hours,
    availability,
    alreadyBooked,
    text,
  };
}

function isTargetCandidate(candidate) {
  if (!candidate.weekday) return false;
  if (!candidate.hours.length) return false;

  return PREFERRED_SLOTS.some((slot) => {
    if (slot.weekday !== candidate.weekday) return false;
    return candidate.hours.some((h) => slot.hours.includes(h));
  });
}

function buildAlertMessage(candidate) {
  return [
    "🚨 Hay cupo en una clase objetivo de Boxmagic",
    "",
    `📅 Día: ${candidate.weekday}`,
    `🕒 Hora(s): ${candidate.hours.join(", ")}`,
    `👥 Cupos: ${candidate.availability.spots ?? "desconocido"}`,
    "",
    `📝 Texto detectado: ${candidate.text.slice(0, 500)}`,
  ].join("\n");
}

async function sendWhatsApp(message) {
  if (!CONFIG.whatsappEnabled) {
    log("📵 WhatsApp desactivado por config");
    return;
  }

  if (
    !CONFIG.twilioSid ||
    !CONFIG.twilioToken ||
    !CONFIG.twilioFrom ||
    !CONFIG.whatsappTo
  ) {
    throw new Error("Faltan variables de entorno de Twilio/WhatsApp");
  }

  const client = twilio(CONFIG.twilioSid, CONFIG.twilioToken);

  const result = await client.messages.create({
    from: CONFIG.twilioFrom,
    to: CONFIG.whatsappTo,
    body: message,
  });

  log(`📲 WhatsApp enviado. SID: ${result.sid}`);
}

async function waitAndClick(page, selectors) {
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if ((await el.count()) > 0) {
      try {
        await el.click({ timeout: 3000 });
        return selector;
      } catch {}
    }
  }
  return null;
}

async function openLogin(page) {
  log("🔐 Abriendo login...");
  await page.goto(CONFIG.entryUrl, {
    waitUntil: "domcontentloaded",
    timeout: CONFIG.timeoutMs,
  });

  await page.waitForTimeout(3000);

  const visibleText = cleanText(await page.locator("body").innerText()).slice(0, 3000);
  log(`📝 Texto visible entry: ${visibleText}`);

  const emailInput = page.locator('input[type="email"], input[name*="email" i]').first();
  if ((await emailInput.count()) > 0) {
    log("✅ Ya estoy en login");
    return;
  }

  const clicked = await waitAndClick(page, [
    'a[href*="login"]',
    'button:has-text("Sign in")',
    'button:has-text("Iniciar sesión")',
    'button:has-text("Ingresar")',
    'a:has-text("Sign in")',
    'a:has-text("Iniciar sesión")',
    'a:has-text("Ingresar")',
  ]);

  if (clicked) {
    log(`👉 Click a login con selector: ${clicked}`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);
  }

  log(`🌐 URL actual: ${page.url()}`);
  const afterText = cleanText(await page.locator("body").innerText()).slice(0, 3000);
  log(`📝 Texto visible login: ${afterText}`);

  const emailNow = page.locator('input[type="email"], input[name*="email" i]').first();
  if ((await emailNow.count()) === 0) {
    throw new Error(`No encontré el campo de email. URL actual: ${page.url()}`);
  }
}

async function login(page) {
  if (!CONFIG.email || !CONFIG.password) {
    throw new Error("Faltan BOXMAGIC_EMAIL o BOXMAGIC_PASSWORD");
  }

  await openLogin(page);

  const emailInput = page.locator('input[type="email"], input[name*="email" i]').first();
  const passwordInput = page
    .locator('input[type="password"], input[name*="password" i]')
    .first();

  if ((await passwordInput.count()) === 0) {
    throw new Error("No encontré el campo de password");
  }

  log('✅ Campo email encontrado: input[type="email"]');
  log('✅ Campo password encontrado: input[type="password"]');

  await emailInput.fill(CONFIG.email);
  await passwordInput.fill(CONFIG.password);

  const submitSelector =
    (await waitAndClick(page, [
      'button[type="submit"]',
      'button:has-text("Sign in")',
      'button:has-text("Ingresar")',
      'button:has-text("Iniciar sesión")',
    ])) || 'button[type="submit"]';

  log(`✅ Submit login con: ${submitSelector}`);

  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(5000);

  log(`🌐 URL post-login: ${page.url()}`);
  const postText = cleanText(await page.locator("body").innerText()).slice(0, 4000);
  log(`📝 Texto visible post-login: ${postText}`);
}

async function goToSchedules(page) {
  log("📅 Buscando vista de horarios...");

  const clicked = await waitAndClick(page, [
    'a[href*="agenda"]',
    'a[href*="schedule"]',
    'button:has-text("See agenda")',
    'button:has-text("Agenda")',
    'a:has-text("See agenda")',
    'a:has-text("Agenda")',
    'a:has-text("Schedules")',
    'button:has-text("Schedules")',
  ]);

  if (clicked) {
    log(`✅ Navegué a horarios con selector: ${clicked}`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(4000);
  } else {
    log("⚠️ No encontré botón claro de agenda. Sigo con la vista actual.");
  }

  log(`🌐 URL horarios: ${page.url()}`);
  const txt = cleanText(await page.locator("body").innerText()).slice(0, 5000);
  log(`📝 Texto visible horarios: ${txt}`);
}

async function collectCandidateTexts(page) {
  const texts = await page.evaluate(() => {
    const selectors = ["div", "li", "article", "section", "button", "a"];
    const nodes = Array.from(document.querySelectorAll(selectors.join(",")));

    return nodes
      .map((el) => (el.innerText || el.textContent || "").trim())
      .filter((t) => t && t.length >= 20 && t.length <= 1200);
  });

  return uniqueStrings(texts).filter(isLikelyClassCard);
}

async function reviewClasses(page) {
  log("🔎 Revisando clases...");

  const candidateTexts = await collectCandidateTexts(page);
  log(`🧩 Candidatos reales recolectados: ${candidateTexts.length}`);

  const parsed = candidateTexts.map(parseCandidate);

  parsed.forEach((c) => {
    log(`🧪 CANDIDATO: ${JSON.stringify(c)}`);
  });

  const targets = parsed.filter(isTargetCandidate);

  targets.forEach((c) => {
    log(`🎯 OBJETIVO: ${JSON.stringify(c)}`);
  });

  if (!targets.length) {
    log("⚪ No encontré clases en horarios objetivo");
    return;
  }

  const actionable = targets.filter(
    (c) => c.availability.available === true && c.alreadyBooked === false
  );

  actionable.forEach((c) => {
    log(`✅ CLASE PARSEADA: ${JSON.stringify(c)}`);
  });

  if (!actionable.length) {
    log("⚪ Hay clases objetivo, pero no corresponde avisar");
    return;
  }

  for (const candidate of actionable) {
    const message = buildAlertMessage(candidate);
    log(`📲 AVISAR: ${message}`);
    await sendWhatsApp(message);
  }
}

async function main() {
  let browser;

  try {
    log("🚀 Monitor iniciado...");

    browser = await chromium.launch({
      headless: CONFIG.headless,
      slowMo: CONFIG.slowMo,
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(CONFIG.timeoutMs);

    await login(page);
    await goToSchedules(page);
    await reviewClasses(page);

    await browser.close();
    log("🟢 Proceso completado");
  } catch (error) {
    log(`❌ Error scraping: ${error.message}`);
    if (browser) {
      try {
        await browser.close();
        log("🧹 Browser cerrado");
      } catch {}
    }
    process.exitCode = 1;
  }
}

main();