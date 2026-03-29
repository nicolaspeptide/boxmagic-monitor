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

const DAY_CODE_MAP = {
  monday: ["MON", "LUN"],
  tuesday: ["TUE", "MAR"],
  wednesday: ["WED", "MIE", "MIÉ"],
  thursday: ["THU", "JUE"],
  friday: ["FRI", "VIE"],
  saturday: ["SAT", "SAB", "SÁB"],
  sunday: ["SUN", "DOM"],
};

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
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
  const source = cleanText(text);
  const out = new Set();

  const rangeRegex =
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|a)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;

  let match;
  while ((match = rangeRegex.exec(source)) !== null) {
    let hour = Number(match[1]);
    const ampm = String(match[3] || match[6] || "").toLowerCase();

    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;

    out.add(hour);
  }

  const isolatedRegex = /\b(\d{1,2})\s*(am|pm)\b/gi;
  while ((match = isolatedRegex.exec(source)) !== null) {
    let hour = Number(match[1]);
    const ampm = String(match[2] || "").toLowerCase();

    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;

    out.add(hour);
  }

  return [...out].filter((n) => !Number.isNaN(n));
}

/**
 * REGLA DURA:
 * - "capacidad completa" / "full capacity" / "fully booked" / "completo" => NO disponible
 * - solo cuenta cupos EXPLÍCITOS dentro del bloque
 * - NO usa "no one registered", "max", "members", etc. como cupos
 */
function extractAvailability(text) {
  const raw = cleanText(text);
  const t = normalize(raw);

  const hardNoAvailabilityPatterns = [
    /capacidad completa/i,
    /full capacity/i,
    /fully booked/i,
    /\bcompleto\b/i,
    /\bagotad[oa]s?\b/i,
    /\bsold out\b/i,
    /\bsin cupos\b/i,
    /\bno spots available\b/i,
    /\bno availability\b/i,
  ];

  for (const pattern of hardNoAvailabilityPatterns) {
    if (pattern.test(t)) {
      return { available: false, spots: 0, reason: "full_capacity" };
    }
  }

  const explicitCountPatterns = [
    /(\d{1,3})\s+(?:espacios?|cupos?|spots?|spaces?)\s+disponibles?\b/i,
    /disponibles?[: ]+(\d{1,3})\b/i,
    /available[: ]+(\d{1,3})\b/i,
    /(\d{1,3})\s+(?:espacios?|cupos?|spots?|spaces?)\s+available\b/i,
    /(\d{1,3})\s+available\b/i,
    /quedan[: ]+(\d{1,3})\b/i,
    /remaining[: ]+(\d{1,3})\b/i,
    /left[: ]+(\d{1,3})\b/i,
  ];

  for (const pattern of explicitCountPatterns) {
    const match = t.match(pattern);
    if (match) {
      const spots = Number(match[1]);
      return {
        available: Number.isFinite(spots) && spots > 0,
        spots: Number.isFinite(spots) ? spots : null,
        reason: "explicit_count",
      };
    }
  }

  const weakAvailablePatterns = [
    /\bspots available\b/i,
    /\bespacios disponibles\b/i,
    /\bcupos disponibles\b/i,
    /\bavailable\b/i,
    /\bdisponible\b/i,
  ];

  for (const pattern of weakAvailablePatterns) {
    if (pattern.test(t)) {
      return { available: true, spots: null, reason: "weak_available_text" };
    }
  }

  return { available: null, spots: null, reason: "unknown" };
}

/**
 * Solo detecta reserva si la tarjeta misma lo dice de forma explícita.
 * Sacamos señales globales ambiguas como "next scheduled session" y "my schedule".
 */
function detectAlreadyBooked(text) {
  const t = normalize(text);

  const patterns = [
    /\balready booked\b/i,
    /\byou are booked\b/i,
    /\byour reservation\b/i,
    /\breservado\b/i,
    /\bya reservado\b/i,
    /\bya inscrito\b/i,
    /\binscrito\b/i,
    /\bbooked\b/i,
  ];

  return patterns.some((pattern) => pattern.test(t));
}

function buildMessage(candidate) {
  return [
    "🚨 Boxmagic",
    "Hay cupo en una clase objetivo.",
    "",
    `📅 Día: ${candidate.weekday}`,
    `🕒 Hora(s): ${candidate.hours.join(", ")}`,
    `👥 Cupos: ${candidate.availability.spots ?? "visible, sin número exacto"}`,
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

    const candidates = Array.from(document.querySelectorAll("button, a, div, span"))
      .filter(visible)
      .map((el) => ({
        text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim(),
      }))
      .filter((x) => x.text.length > 0 && x.text.length <= 40);

    return candidates;
  });

  const uniq = uniqueBy(tabs, (x) => normalize(x.text));
  log(`📚 Tabs visibles: ${uniq.map((x) => x.text).join(" | ").slice(0, 1200)}`);
  return uniq;
}

async function collectCalendarCells(page) {
  return await page.evaluate(() => {
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

    function norm(s = "") {
      return String(s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    }

    function looksLikeDayToken(text) {
      const t = norm(text).toUpperCase();
      return [
        "SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT",
        "DOM", "LUN", "MAR", "MIE", "MIÉ", "JUE", "VIE", "SAB", "SÁB",
      ].includes(t);
    }

    function looksLikeSmallDateToken(text) {
      const t = norm(text);
      return /^\d{1,2}$/.test(t);
    }

    const elements = Array.from(document.querySelectorAll("button, a, div, span"))
      .filter(visible);

    const raw = elements.map((el) => {
      const text = norm(el.innerText || el.textContent || "");
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        text,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    });

    const dayTokens = raw.filter((x) => looksLikeDayToken(x.text));
    const dateTokens = raw.filter((x) => looksLikeSmallDateToken(x.text));

    const cells = dayTokens.map((day) => {
      const nearbyDates = dateTokens
        .filter((d) => Math.abs(d.x - day.x) < 40 && Math.abs(d.y - day.y) < 80)
        .sort((a, b) => Math.abs(a.y - day.y) - Math.abs(b.y - day.y));

      return {
        dayText: day.text,
        dateText: nearbyDates[0]?.text || null,
        x: day.x,
        y: day.y,
        w: day.w,
        h: day.h,
      };
    });

    return cells;
  });
}

async function clickDayByStructure(page, weekday) {
  const codes = DAY_CODE_MAP[weekday] || [];
  log(`📆 Intentando abrir día: ${weekday} (${codes.join(", ")})`);

  const cells = await collectCalendarCells(page);
  const normalizedCodes = codes.map((x) => normalize(x));
  const matches = cells.filter((cell) =>
    normalizedCodes.includes(normalize(cell.dayText))
  );

  for (const cell of matches) {
    const clicked = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x + 5, y + 5);
        if (!el) return false;

        const candidates = [];
        let current = el;
        for (let i = 0; i < 5 && current; i += 1) {
          candidates.push(current);
          current = current.parentElement;
        }

        for (const candidate of candidates) {
          try {
            candidate.click();
            return true;
          } catch {}
        }

        return false;
      },
      { x: cell.x, y: cell.y }
    );

    if (clicked) {
      await page.waitForTimeout(2500);
      log(`✅ Día abierto por estructura: ${weekday} -> ${cell.dayText} ${cell.dateText || ""}`);
      return true;
    }
  }

  for (const code of codes) {
    const fallbackSelectors = [
      `button:has-text("${code}")`,
      `a:has-text("${code}")`,
      `div:has-text("${code}")`,
      `span:has-text("${code}")`,
      `text=${code}`,
    ];

    for (const selector of fallbackSelectors) {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0) {
        try {
          await locator.click({ timeout: 2500 });
          await page.waitForTimeout(2500);
          log(`✅ Día abierto con fallback selector: ${selector}`);
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

      const hasTimeRange =
        /\d{1,2}(?::\d{2})?\s*(am|pm)?\s*(to|-|a)\s*\d{1,2}(?::\d{2})?\s*(am|pm)?/i.test(text);

      const hasSessionLanguage =
        t.includes("entrenamiento") ||
        t.includes("session") ||
        t.includes("in person") ||
        t.includes("capacity") ||
        t.includes("capacidad") ||
        t.includes("spots") ||
        t.includes("cupos") ||
        t.includes("available") ||
        t.includes("disponible") ||
        t.includes("full capacity") ||
        t.includes("completo");

      return hasTimeRange && hasSessionLanguage;
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
      "div",
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

function inferWeekdayFromText(text) {
  const n = normalize(text);

  for (const [weekday, aliases] of Object.entries(WEEKDAY_ALIASES)) {
    if (aliases.some((alias) => n.includes(normalize(alias)))) {
      return weekday;
    }
  }

  return null;
}

function parseSessionCandidate(text, forcedWeekday = null) {
  return {
    weekday: forcedWeekday || inferWeekdayFromText(text),
    hours: extractHours(text),
    availability: extractAvailability(text),
    alreadyBooked: detectAlreadyBooked(text),
    text: cleanText(text),
  };
}

function isTargetSlot(weekday, hours) {
  return TARGET_SLOTS.some(
    (slot) =>
      slot.weekday === weekday &&
      hours.some((hour) => slot.hours.includes(hour))
  );
}

async function reviewClassesDayByDay(page) {
  log("🔎 Revisando clases día-por-día...");
  await listVisibleDayTabs(page);

  const allParsed = [];

  for (const target of TARGET_SLOTS) {
    log(`🗓️ Procesando día objetivo: ${target.weekday}`);

    const opened = await clickDayByStructure(page, target.weekday);
    if (!opened) {
      continue;
    }

    const pageText = await safeBodyText(page);
    log(`📝 Texto visible ${target.weekday}: ${pageText.slice(0, 1500)}`);

    const rawBlocks = await collectSessionBlocks(page);
    log(`🧩 Bloques sesión ${target.weekday}: ${rawBlocks.length}`);

    const parsed = rawBlocks
      .map((b) => parseSessionCandidate(b.text, target.weekday))
      .filter((x) => x.hours.length > 0)
      .filter((x) => isTargetSlot(x.weekday, x.hours));

    for (const item of parsed) {
      log(`🎯 CANDIDATO ${target.weekday}: ${JSON.stringify(item).slice(0, 1200)}`);
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

  const actionable = uniqueParsed.filter((c) => {
    if (c.alreadyBooked) return false;
    if (c.availability.available !== true) return false;

    // Si el texto dice full capacity/completo, nunca avisar aunque otra regla falle.
    if (c.availability.reason === "full_capacity") return false;

    return true;
  });

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