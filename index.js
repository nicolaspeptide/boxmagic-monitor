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
  twilioFrom: process.env.TWILIO_WHATSAPP_FROM,
  whatsappTo: process.env.WHATSAPP_TO,

  headless: true,
  timeoutMs: 30000,
};

const TARGET_SLOTS = [
  { weekday: "monday", hours: [19, 20] },
  { weekday: "tuesday", hours: [19, 20] },
  { weekday: "wednesday", hours: [20] },
  { weekday: "friday", hours: [19] },
];

const WEEKDAY_ALIASES = {
  monday: ["monday", "mon", "lunes", "lun"],
  tuesday: ["tuesday", "tue", "martes", "mar"],
  wednesday: ["wednesday", "wed", "miercoles", "miércoles", "mie", "mié"],
  thursday: ["thursday", "thu", "jueves", "jue"],
  friday: ["friday", "fri", "viernes", "vie"],
  saturday: ["saturday", "sat", "sabado", "sábado", "sab"],
  sunday: ["sunday", "sun", "domingo", "dom"],
};

function log(msg) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

function cleanText(text = "") {
  return String(text)
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalize(text = "") {
  return cleanText(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function uniqueBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function getTomorrowWeekday() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ][d.getDay()];
}

function detectWeekday(text) {
  const t = normalize(text);

  if (t.includes("tomorrow")) return getTomorrowWeekday();
  if (t.includes("manana") || t.includes("mañana")) return getTomorrowWeekday();

  for (const [weekday, aliases] of Object.entries(WEEKDAY_ALIASES)) {
    if (aliases.some((a) => t.includes(normalize(a)))) return weekday;
  }

  return null;
}

function extractHours(text) {
  const t = normalize(text);
  const out = new Set();

  const rangeRegex =
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|a)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;

  let m;
  while ((m = rangeRegex.exec(t)) !== null) {
    let h = Number(m[1]);
    const ampm = (m[3] || m[6] || "").toLowerCase();

    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;

    out.add(h);
  }

  const hRegex = /\b(\d{1,2})\s*h\b/gi;
  while ((m = hRegex.exec(t)) !== null) {
    out.add(Number(m[1]));
  }

  return [...out].filter((n) => !Number.isNaN(n));
}

function extractAvailability(text) {
  const t = normalize(text);

  if (
    t.includes("capacidad completa") ||
    t.includes("full capacity") ||
    t.includes("completo") ||
    t.includes("sold out")
  ) {
    return { available: false, spots: 0, reason: "full_capacity" };
  }

  let m =
    t.match(/\b(\d{1,3})\s+(?:spots?|spaces?|cupos?)\s+(?:available|disponibles?)\b/i) ||
    t.match(/\bavailable[: ]+(\d{1,3})\b/i) ||
    t.match(/\bdisponibles?[: ]+(\d{1,3})\b/i) ||
    t.match(/\b(\d{1,3})\s+available\b/i);

  if (m) {
    const spots = Number(m[1]);
    return { available: spots > 0, spots, reason: "explicit_count" };
  }

  if (t.includes("no one registered")) {
    return { available: true, spots: 999, reason: "empty_class" };
  }

  return { available: null, spots: null, reason: "unknown" };
}

function detectAlreadyBooked(text) {
  const t = normalize(text);
  return (
    t.includes("already booked") ||
    t.includes("reservado") ||
    t.includes("booked") ||
    t.includes("inscrito") ||
    t.includes("scheduled by you")
  );
}

function isTargetSlot(weekday, hours) {
  return TARGET_SLOTS.some(
    (slot) =>
      slot.weekday === weekday && hours.some((hour) => slot.hours.includes(hour))
  );
}

function buildMessage(candidate) {
  return [
    "🚨 Boxmagic",
    "Hay cupo en una clase objetivo.",
    "",
    `📅 Día: ${candidate.weekday}`,
    `🕒 Hora(s): ${candidate.hours.join(", ")}`,
    `👥 Cupos: ${candidate.availability.spots ?? "desconocido"}`,
    "",
    `📝 ${candidate.text.slice(0, 500)}`,
  ].join("\n");
}

async function sendWhatsapp(body) {
  if (!CONFIG.whatsappEnabled) {
    log("📵 WhatsApp desactivado");
    return;
  }

  if (
    !CONFIG.twilioSid ||
    !CONFIG.twilioToken ||
    !CONFIG.twilioFrom ||
    !CONFIG.whatsappTo
  ) {
    throw new Error("Faltan variables de Twilio/WhatsApp");
  }

  const client = twilio(CONFIG.twilioSid, CONFIG.twilioToken);
  const result = await client.messages.create({
    from: CONFIG.twilioFrom,
    to: CONFIG.whatsappTo,
    body,
  });

  log(`📲 AVISAR SID=${result.sid}`);
}

async function safeBodyText(page) {
  return cleanText(await page.locator("body").innerText());
}

async function clickFirstExisting(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      try {
        await locator.click({ timeout: 2500 });
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

  const text = await safeBodyText(page);
  log(`📝 Texto visible entry: ${text.slice(0, 1200)}`);

  const emailInput = page.locator('input[type="email"]').first();
  if ((await emailInput.count()) > 0) {
    log("✅ Ya estoy en login");
    return;
  }

  const clicked = await clickFirstExisting(page, [
    'a[href*="login"]',
    'a:has-text("Sign in")',
    'a:has-text("Iniciar sesión")',
    'a:has-text("Ingresar")',
    'button:has-text("Sign in")',
    'button:has-text("Iniciar sesión")',
    'button:has-text("Ingresar")',
  ]);

  if (clicked) {
    log(`👉 Click a login con selector: ${clicked}`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(3000);
  }

  if ((await page.locator('input[type="email"]').count()) === 0) {
    throw new Error(`No encontré el campo email. URL=${page.url()}`);
  }
}

async function login(page) {
  if (!CONFIG.email || !CONFIG.password) {
    throw new Error("Faltan BOXMAGIC_EMAIL o BOXMAGIC_PASSWORD");
  }

  await openLogin(page);

  const emailInput = page.locator('input[type="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();

  if ((await passwordInput.count()) === 0) {
    throw new Error("No encontré el campo password");
  }

  await emailInput.fill(CONFIG.email);
  await passwordInput.fill(CONFIG.password);

  const submitUsed =
    (await clickFirstExisting(page, [
      'button[type="submit"]',
      'button:has-text("Sign in")',
      'button:has-text("Ingresar")',
      'button:has-text("Iniciar sesión")',
    ])) || 'button[type="submit"]';

  log(`✅ Submit login con: ${submitUsed}`);

  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(5000);

  log(`🌐 URL post-login: ${page.url()}`);
  const postText = await safeBodyText(page);
  log(`📝 Texto visible post-login: ${postText.slice(0, 2500)}`);
}

async function goToSchedules(page) {
  log("📅 Buscando vista de horarios...");

  const used = await clickFirstExisting(page, [
    'a[href*="horarios"]',
    'a[href*="schedule"]',
    'a[href*="agenda"]',
    'a:has-text("Schedules")',
    'a:has-text("Agenda")',
    'a:has-text("See agenda")',
    'button:has-text("Schedules")',
    'button:has-text("Agenda")',
    'button:has-text("See agenda")',
  ]);

  if (used) {
    log(`✅ Navegué a horarios con selector: ${used}`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(4000);
  } else {
    log("⚠️ No encontré botón claro de horarios");
  }

  log(`🌐 URL horarios: ${page.url()}`);
  const txt = await safeBodyText(page);
  log(`📝 Texto visible horarios: ${txt.slice(0, 2500)}`);
}

function splitTextIntoDayBlocks(fullText) {
  const raw = cleanText(fullText);

  const dayPattern =
    /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|lun(?:es)?|mar(?:tes)?|mie(?:rcoles)?|mié(?:rcoles)?|jue(?:ves)?|vie(?:rnes)?|sab(?:ado)?|sáb(?:ado)?|dom(?:ingo)?)\s+\d{1,2}\b/gi;

  const matches = [...raw.matchAll(dayPattern)];

  if (!matches.length) return [];

  const blocks = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : raw.length;

    const header = matches[i][0];
    const chunk = raw.slice(start, end).trim();

    blocks.push({
      header,
      weekday: detectWeekday(header),
      text: chunk,
    });
  }

  return blocks;
}

function extractCandidateLinesFromBlock(blockText) {
  const text = cleanText(blockText);

  const pieces = text
    .split(/(?=(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|-|a)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?))/gi)
    .map((x) => cleanText(x))
    .filter(Boolean);

  return pieces.filter((piece) => {
    const t = normalize(piece);

    const hasTime =
      /(\d{1,2}(?::\d{2})?\s*(am|pm)?\s*(to|-|a)\s*\d{1,2}(?::\d{2})?\s*(am|pm)?)/i.test(
        piece
      );

    const hasClassSignals =
      t.includes("full capacity") ||
      t.includes("capacidad completa") ||
      t.includes("registered") ||
      t.includes("available") ||
      t.includes("members") ||
      t.includes("in person") ||
      t.includes("entrenamiento") ||
      t.includes("schedule") ||
      t.includes("session") ||
      t.includes("sesion") ||
      t.includes("sesión") ||
      t.includes("no one registered");

    return hasTime && hasClassSignals;
  });
}

function parseCandidate(text, forcedWeekday = null) {
  return {
    weekday: forcedWeekday || detectWeekday(text),
    hours: extractHours(text),
    availability: extractAvailability(text),
    alreadyBooked: detectAlreadyBooked(text),
    text: cleanText(text),
  };
}

async function reviewClasses(page) {
  log("🔎 Revisando clases...");

  const fullText = await safeBodyText(page);
  const dayBlocks = splitTextIntoDayBlocks(fullText);

  log(
    `📚 Bloques de días detectados: ${
      dayBlocks.map((b) => `${b.header}=>${b.weekday}`).join(" | ") || "NINGUNO"
    }`
  );

  const targetBlocks = dayBlocks.filter(
    (b) => b.weekday && TARGET_SLOTS.some((s) => s.weekday === b.weekday)
  );

  log(
    `🎯 Bloques objetivo: ${
      targetBlocks.map((b) => `${b.header}=>${b.weekday}`).join(" | ") || "NINGUNO"
    }`
  );

  if (!targetBlocks.length) {
    log("⚪ No encontré bloques de días objetivo");
    return;
  }

  let allCandidates = [];

  for (const block of targetBlocks) {
    log(`🗓️ Procesando bloque: ${block.header} => ${block.weekday}`);

    const lines = extractCandidateLinesFromBlock(block.text);
    log(`🧩 Candidatos crudos en ${block.weekday}: ${lines.length}`);

    const parsed = lines.map((line) => parseCandidate(line, block.weekday));

    for (const p of parsed) {
      log(`🧪 CANDIDATO ${block.weekday}: ${JSON.stringify(p)}`);
    }

    allCandidates.push(...parsed);
  }

  allCandidates = uniqueBy(allCandidates, (x) => normalize(x.text));
  log(`🧩 Candidatos reales recolectados: ${allCandidates.length}`);

  const targets = allCandidates.filter(
    (c) => c.weekday && c.hours.length && isTargetSlot(c.weekday, c.hours)
  );

  for (const t of targets) {
    log(`🎯 OBJETIVO: ${JSON.stringify(t)}`);
  }

  if (!targets.length) {
    log("⚪ No encontré clases en horarios objetivo");
    return;
  }

  const actionable = targets.filter(
    (c) => c.availability.available === true && c.alreadyBooked === false
  );

  for (const a of actionable) {
    log(`✅ CLASE PARSEADA: ${JSON.stringify(a)}`);
  }

  if (!actionable.length) {
    log("⚪ Hay objetivos, pero no corresponde avisar");
    return;
  }

  for (const candidate of actionable) {
    const msg = buildMessage(candidate);
    log(`📲 AVISAR: ${msg}`);
    await sendWhatsapp(msg);
  }
}

async function main() {
  let browser;

  try {
    log("🚀 Monitor iniciado...");

    browser = await chromium.launch({
      headless: CONFIG.headless,
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