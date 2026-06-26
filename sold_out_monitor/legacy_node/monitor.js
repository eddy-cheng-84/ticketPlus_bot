import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);

const CONFIG = {
  url:
    process.env.TICKETPLUS_URL ||
    "https://ticketplus.com.tw/activity/2491b53add42613bd12fe923e2c29058",
  pollMs: Number.parseInt(process.env.POLL_MS || "60000", 10),
  pollMinMs: Number.parseInt(process.env.POLL_MIN_MS || "0", 10),
  pollMaxMs: Number.parseInt(process.env.POLL_MAX_MS || "0", 10),
  alertRepeatCount: Number.parseInt(process.env.ALERT_REPEAT_COUNT || "3", 10),
  alertRepeatIntervalMs: Number.parseInt(process.env.ALERT_REPEAT_INTERVAL_MS || "60000", 10),
  webhookUrl: process.env.WEBHOOK_URL || "",
  webhookFormat: (process.env.WEBHOOK_FORMAT || "ntfy").toLowerCase(),
  ntfyTitle: process.env.NTFY_TITLE || "TicketPlus availability alert",
  ntfyPriority: process.env.NTFY_PRIORITY || "urgent",
  ntfyTags: process.env.NTFY_TAGS || "warning,ticket",
  extensionTriggerEnabled:
    (process.env.EXTENSION_TRIGGER_ENABLED || "false").toLowerCase() === "true",
  extensionTriggerUrl: process.env.EXTENSION_TRIGGER_URL || "http://127.0.0.1:16888/trigger",
  extensionTriggerMethod: (process.env.EXTENSION_TRIGGER_METHOD || "POST").toUpperCase(),
  headless: (process.env.HEADLESS || "false").toLowerCase() === "true",
  browserChannel: process.env.BROWSER_CHANNEL || "chrome",
  fastMode: (process.env.FAST_MODE || "true").toLowerCase() === "true",
  timeoutMs: Number.parseInt(process.env.TIMEOUT_MS || "30000", 10),
  stateFile:
    process.env.STATE_FILE || path.join(process.cwd(), ".ticketplus-monitor-state.json"),
};

const TARGETS = [
  {
    id: "2026-06-19",
    date: "2026-06-19",
    label: "LiVE is Smile Always～15～ in Taipei(6/19場次)",
  },
  {
    id: "2026-06-20",
    date: "2026-06-20",
    label: "LiVE is Smile Always～15～ in Taipei(6/20場次)",
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNextPollMs() {
  const { pollMs, pollMinMs, pollMaxMs } = CONFIG;

  if (
    Number.isFinite(pollMinMs) &&
    Number.isFinite(pollMaxMs) &&
    pollMinMs > 0 &&
    pollMaxMs >= pollMinMs
  ) {
    const span = pollMaxMs - pollMinMs + 1;
    return pollMinMs + Math.floor(Math.random() * span);
  }

  return pollMs;
}

function normalizeLine(line) {
  return line.replace(/\s+/g, " ").trim();
}

function nowIso() {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    hourCycle: "h23",
  });

  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}+08:00`;
}

// Build the structured payload used by JSON webhooks and debugging output.
function buildPayload(results, changedToAvailable, checkedAt) {
  const availableTargets = results.filter((item) => item.isAvailable);
  return {
    source: "ticketplus-monitor",
    url: CONFIG.url,
    checkedAt,
    availableCount: availableTargets.length,
    availableTargets,
    changedToAvailable,
    results,
  };
}

// Keep the popup text compact so ntfy notifications are easy to scan.
function buildShortAvailabilityMessage(changedToAvailable, checkedAt) {
  const dates = changedToAvailable.map((item) => item.date).join(", ");
  return `${dates} 有票 [${checkedAt}]`;
}

// Send ntfy notifications with curl.exe so the behavior matches a manual curl command on Windows.
async function sendNtfyWithCurl(title, message) {
  const args = [
    "-H",
    `Title: ${title}`,
    "-H",
    `Priority: ${CONFIG.ntfyPriority}`,
    "-H",
    `Tags: ${CONFIG.ntfyTags}`,
    "-d",
    message,
    CONFIG.webhookUrl,
  ];

  try {
    await execFileAsync("curl.exe", args, {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const stderr = error?.stderr || "";
    const stdout = error?.stdout || "";
    throw new Error(`ntfy request failed: ${stderr || stdout || error.message}`);
  }
}

// Persist the last known availability so we only notify on state changes.
async function readState() {
  try {
    const raw = await fs.readFile(CONFIG.stateFile, "utf8");
    const parsed = JSON.parse(raw);
    return {
      availabilityById: parsed.availabilityById || {},
    };
  } catch {
    return {
      availabilityById: {},
    };
  }
}

async function writeState(state) {
  await fs.writeFile(CONFIG.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

// ntfy uses a short title popup, while JSON mode sends the full structured payload.
async function sendWebhook(payload) {
  if (!CONFIG.webhookUrl) {
    throw new Error("WEBHOOK_URL is not set.");
  }

  if (CONFIG.webhookFormat === "ntfy") {
    const shortMessage = buildShortAvailabilityMessage(payload.changedToAvailable, payload.checkedAt);
    await sendNtfyWithCurl(shortMessage, "");
    return;
  }

  const response = await fetch(CONFIG.webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Webhook failed: ${response.status} ${response.statusText} ${body}`);
  }
}

async function sendRepeatedWebhook(payload) {
  const repeatCount = Math.max(1, CONFIG.alertRepeatCount);
  const repeatIntervalMs = Math.max(0, CONFIG.alertRepeatIntervalMs);

  for (let attempt = 1; attempt <= repeatCount; attempt += 1) {
    await sendWebhook(payload);
    console.log(`[${nowIso()}] Webhook sent (${attempt}/${repeatCount})`);

    if (attempt < repeatCount) {
      console.log(`[${nowIso()}] Waiting ${repeatIntervalMs}ms before next webhook`);
      await sleep(repeatIntervalMs);
    }
  }
}

async function sendExtensionTrigger(payload) {
  if (!CONFIG.extensionTriggerEnabled || !CONFIG.extensionTriggerUrl) {
    return false;
  }

  const method = CONFIG.extensionTriggerMethod === "GET" ? "GET" : "POST";

  if (method === "GET") {
    const url = new URL(CONFIG.extensionTriggerUrl);
    url.searchParams.set("fire", "1");
    url.searchParams.set("id", `monitor-${Date.now()}`);
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Extension GET trigger failed: ${response.status} ${response.statusText} ${body}`);
    }

    return true;
  }

  const triggerPayload = {
    trigger: true,
    id: `monitor-${payload.checkedAt}`,
    source: "ticketplus-monitor",
    payload,
  };

  const response = await fetch(CONFIG.extensionTriggerUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(triggerPayload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Extension POST trigger failed: ${response.status} ${response.statusText} ${body}`);
  }

  return true;
}

// Test mode lets you verify the webhook path without waiting for ticket availability to change.
async function sendTestNotification() {
  if (!CONFIG.webhookUrl) {
    throw new Error("WEBHOOK_URL is not set.");
  }

  const checkedAt = nowIso();

  if (CONFIG.webhookFormat === "ntfy") {
    const testMessage = `TicketPlus 測試通知 [${checkedAt}]`;
    await sendNtfyWithCurl(testMessage, "");
    console.log("Test ntfy notification sent.");
    return;
  }

  const payload = {
    source: "ticketplus-monitor",
    type: "test",
    checkedAt,
    message: "This is a test notification from ticketplus-monitor.",
  };

  await sendWebhook(payload);
  console.log("Test JSON webhook sent.");
}

// Parse the page text and inspect only the local block around each target session.
function extractResultsFromText(rawText) {
  const lines = rawText
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean);

  return TARGETS.map((target, index) => {
    const startIndex = lines.findIndex((line) => line.includes(target.label));
    const nextLabel = TARGETS[index + 1]?.label;
    const nextIndex = nextLabel
      ? lines.findIndex((line, idx) => idx > startIndex && line.includes(nextLabel))
      : -1;

    if (startIndex === -1) {
      return {
        id: target.id,
        date: target.date,
        label: target.label,
        found: false,
        isSoldOut: null,
        isAvailable: false,
        evidence: [],
      };
    }

    const endIndex = nextIndex > startIndex ? nextIndex : Math.min(lines.length, startIndex + 8);
    const evidence = lines.slice(startIndex, endIndex);
    const isSoldOut = evidence.some((line) => line.includes("銷售一空"));

    return {
      id: target.id,
      date: target.date,
      label: target.label,
      found: true,
      isSoldOut,
      isAvailable: !isSoldOut,
      evidence,
    };
  });
}

// Fast mode reuses one page and reloads it. Stable mode opens a fresh page each loop.
async function fetchAvailability(browser, sharedPage) {
  const page = sharedPage || (await browser.newPage());
  const shouldReusePage = Boolean(sharedPage);

  try {
    if (shouldReusePage && page.__ticketplusInitialized) {
      await page.reload({
        waitUntil: "domcontentloaded",
        timeout: CONFIG.timeoutMs,
      });
    } else {
      await page.goto(CONFIG.url, {
        waitUntil: "domcontentloaded",
        timeout: CONFIG.timeoutMs,
      });
      page.__ticketplusInitialized = true;
    }

    await page.waitForTimeout(5000);
    await page.waitForFunction(
      (text) => document.body?.innerText.includes(text),
      "售票狀態",
      { timeout: CONFIG.timeoutMs }
    );

    const rawText = await page.evaluate(() => document.body?.innerText || "");
    const title = await page.title();
    const results = extractResultsFromText(rawText);
    return { title, results };
  } finally {
    if (!shouldReusePage) {
      await page.close();
    }
  }
}

function buildNextAvailabilityState(results) {
  const next = {};
  for (const result of results) {
    next[result.id] = result.isAvailable;
  }
  return next;
}

// Notify only when a session transitions from sold out to available.
async function runCheck(browser, sharedPage) {
  const checkedAt = nowIso();
  const { title, results } = await fetchAvailability(browser, sharedPage);
  const state = await readState();

  console.log(`[${checkedAt}] ${title}`);
  for (const result of results) {
    const status = result.found
      ? result.isSoldOut
        ? "銷售一空"
        : "有票"
      : "未找到場次";
    console.log(`- ${result.id}: ${status}`);
  }

  const changedToAvailable = results.filter((result) => {
    if (!result.found || !result.isAvailable) {
      return false;
    }

    const previous = state.availabilityById[result.id];
    return previous !== true;
  });

  if (changedToAvailable.length > 0) {
    const payload = buildPayload(results, changedToAvailable, checkedAt);
    await sendRepeatedWebhook(payload);
    await sendExtensionTrigger(payload);
    console.log(
      `Webhook sent and extension triggered for available date(s): ${changedToAvailable
        .map((item) => item.date)
        .join(", ")}`
    );
  }

  await writeState({
    availabilityById: buildNextAvailabilityState(results),
  });
}

async function main() {
  if (!CONFIG.webhookUrl) {
    console.error("Please set WEBHOOK_URL before running this monitor.");
    process.exit(1);
  }

  const runOnce = process.argv.includes("--once");
  const testNotify = process.argv.includes("--test-notify");

  if (testNotify) {
    await sendTestNotification();
    return;
  }

  const browser = await chromium.launch({
    headless: CONFIG.headless,
    channel: CONFIG.browserChannel,
  });
  const sharedPage = CONFIG.fastMode ? await browser.newPage() : null;

  try {
    do {
      try {
        await runCheck(browser, sharedPage);
      } catch (error) {
        console.error(
          `[${nowIso()}] Check failed:`,
          error instanceof Error ? error.message : error
        );
      }

      if (!runOnce) {
        const nextPollMs = getNextPollMs();
        console.log(`[${nowIso()}] Next check in ${nextPollMs}ms`);
        await sleep(nextPollMs);
      }
    } while (!runOnce);
  } finally {
    if (sharedPage) {
      await sharedPage.close();
    }
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
