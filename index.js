import { chromium } from "playwright";
import twilio from "twilio";

const CONFIG = {
  entryUrl:
    process.env.BOXMAGIC_ENTRY_URL ||
    "https://members.boxmagic.app/a/g/oGDPQaGLb5/perfil?o=a-iugpd",

  email: process.env.BOXMAGIC_EMAIL || "",
  password: process.env.BOXMAGIC_PASSWORD || "",

  whatsappEnabled:
    String(process.env.WHATSAPP_ENABLED || "false").toLowerCase() === "true",

  twilioSid: process.env.TWILIO_ACCOUNT_SID || "",
  twilioToken: process.env.TWILIO_AUTH_TOKEN || "",
  twilioFrom: process.env.TWILIO_WHATSAPP_FROM || "",
  whatsappTo: process.env.WHATSAPP_TO || "",

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

const DAY_TAB_LABELS = {
  monday: ["MON", "MONDAY", "LUN", "LUNES"],
  tuesday: ["TUE", "TUESDAY", "MAR", "MARTES"],
  wednesday: ["WED", "WEDNESDAY", "MIE", "MIÉ", "MIERCOLES", "MIÉRCOLES"],
  thursday: ["THU", "THURSDAY", "JUE", "JUEVES"],
  friday: ["FRI", "FRIDAY", "VIE", "VIERNES"],
  saturday: ["SAT", "SATURDAY", "SAB", "SÁB", "SABADO", "SÁBADO"],
  sunday: ["SUN", "SUNDAY", "DOM", "DOMINGO"],
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

  const isolated = /\b(\d{1,2})\s*(am|pm)\b/gi;
  while ((m = isolated.exec(t)) !== null) {
    let h = Number(m[1]);
    const ampm = (m[2] || "").toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    out.add(h);
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
    t.match(/\b(\d{1,3})\s+available\b/i) ||
    t.match(/\b(\d{1,3})\s+cupos?\b/i);

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
    t.includes("scheduled by you") ||
    t.includes("your reservation") ||
    t.includes("my schedule")
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

async function listVisibleDayTabs(page) {
  const tabs = await page.evaluate(() => {
    function visible(el) {
      const st = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        st.display !== "none" &&
        st.visibility !== "hidden" &&
        Number(st.opacity || "1") > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    const all = Array.from(
      document.querySelectorAll("button, a, div, span")
    ).filter(visible);

    return all
      .map((el) => ({
        text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim(),
      }))
      .filter((x) => x.text.length > 0 && x.text.length <= 30);
  });

  const uniq = uniqueBy(tabs, (x) => normalize(x.text));
  log(`📚 Tabs visibles: ${uniq.map((x) => x.text).join(" | ").slice(0, 1000)}`);
  return uniq;
}

async function clickDayTab(page, weekday) {
  const labels = DAY_TAB_LABELS[weekday] || [];
  log(`📆 Intentando abrir día: ${weekday} (${labels.join(", ")})`);

  for (const label of labels) {
    const selectors = [
      `button:has-text("${label}")`,
      `a:has-text("${label}")`,
      `div:has-text("${label}")`,
      `span:has-text("${label}")`,
      `text=${label}`,
    ];

    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0) {
        try {
          await locator.click({ timeout: 2500 });
          await page.waitForTimeout(2500);
          log(`✅ Día abierto con selector: ${selector}`);
          return true;
        } catch {}
      }
    }
  }

  log(`⚪ No pude abrir tab para ${weekday}`);
  return false;
}

async function collectSessionBlocks(page) {
  const items = await page.evaluate(() => {
    function normalizeText(s = "") {
      return String(s || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function visible(el) {
      const st = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        st.display !== "none" &&
        st.visibility !== "hidden" &&
        Number(st.opacity || "1") > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    function looksLikeSession(text) {
      const t = text.toLowerCase();
      return (
        /\d{1,2}(?::\d{2})?\s*(am|pm)?\s*(to|-|a)\s*\d{1,2}(?::\d{2})?\s*(am|pm)?/i.test(text) &&
        (
          t.includes("full capacity") ||
          t.includes("no one registered") ||
          t.includes("available") ||
          t.includes("members") ||
          t.includes("in person") ||
          t.includes("scheduled") ||
          t.includes("session") ||
          t.includes("entrenamiento") ||
          t.includes("capacidad") ||
          t.includes("registered")
        )
      );
    }

    const selectors = [
      "article",
      "section",
      "li",
      "[role='listitem']",
      "[class*='card']",
      "[class*='item']",
      "[class*='session']",
      "[class*='schedule']",
      "[class*='slot']",
      "div"
    ];

    const nodes = Array.from(document.querySelectorAll(selectors.join(",")))
      .filter(visible)
      .map((el) => {
        const text = normalizeText(el.innerText || el.textContent || "");
        const rect = el.getBoundingClientRect();
        return {
          text,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          tag: el.tagName,
          cls: String(el.className || ""),
        };
      })
      .filter((x) => x.text.length >= 8 && x.text.length <= 800)
      .filter((x) => looksLikeSession(x.text));

    return nodes;
  });

  return uniqueBy(items, (x) => `${x.y}|${normalize(x.text)}`);
}

function parseSessionCandidate(text, forcedWeekday) {
  return {
    weekday: forcedWeekday,
    hours: extractHours(text),
    availability: extractAvailability(text),
    alreadyBooked: detectAlreadyBooked(text),
    text: cleanText(text),
  };
}

function isTargetSlot(weekday, hours) {
  return TARGET_SLOTS.some(
    (slot) =>
      slot.weekday === weekday && hours.some((hour) => slot.hours.includes(hour))
  );
}

async function reviewClassesDayByDay(page) {
  log("🔎 Revisando clases día-por-día...");
  await listVisibleDayTabs(page);

  const allParsed = [];

  for (const target of TARGET_SLOTS) {
    log(`➡️ Procesando día objetivo: ${target.weekday}`);

    const opened = await clickDayTab(page, target.weekday);
    if (!opened) {
      continue;
    }

    const pageText = await safeBodyText(page);
    log(`📝 Texto visible ${target.weekday}: ${pageText.slice(0, 1200)}`);

    const rawBlocks = await collectSessionBlocks(page);
    log(`🧩 Bloques sesión ${target.weekday}: ${rawBlocks.length}`);

    for (const block of rawBlocks) {
      log(`🧱 BLOQUE ${target.weekday}: ${JSON.stringify(block)}`);
    }

    const parsed = rawBlocks
      .map((b) => parseSessionCandidate(b.text, target.weekday))
      .filter((x) => x.hours.length > 0)
      .filter((x) => isTargetSlot(x.weekday, x.hours));

    for (const item of parsed) {
      log(`🎯 OBJETIVO ${target.weekday}: ${JSON.stringify(item)}`);
    }

    allParsed.push(...parsed);
  }

  const uniqueParsed = uniqueBy(
    allParsed,
    (x) => `${x.weekday}|${x.hours.join(",")}|${normalize(x.text)}`
  );

  if (!uniqueParsed.length) {
    log("⚪ No encontré clases en horarios objetivo");
    return;
  }

  const actionable = uniqueParsed.filter(
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
    await reviewClassesDayByDay(page);

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