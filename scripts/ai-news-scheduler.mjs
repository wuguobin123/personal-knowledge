import { collectDailyAiNews } from "./ai-news-collector.mjs";

const TIMEZONE = process.env.AI_NEWS_TIMEZONE || "Asia/Shanghai";
const RUN_AT = process.env.AI_NEWS_RUN_AT || "07:00";
const CHECK_INTERVAL_SECONDS = Number.parseInt(
  process.env.AI_NEWS_CHECK_INTERVAL_SECONDS ?? "60",
  10,
);
const RETRY_COOLDOWN_SECONDS = Number.parseInt(
  process.env.AI_NEWS_RETRY_COOLDOWN_SECONDS ?? "900",
  10,
);
const RUN_ON_START = process.env.AI_NEWS_RUN_ON_START === "true";

function parseRunAt(value) {
  const matched = String(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) {
    return { hour: 7, minute: 0 };
  }

  const hour = Number.parseInt(matched[1], 10);
  const minute = Number.parseInt(matched[2], 10);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { hour: 7, minute: 0 };
  }

  return { hour, minute };
}

function getNowParts(timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const hour = Number.parseInt(parts.find((part) => part.type === "hour")?.value ?? "0", 10);
  const minute = Number.parseInt(parts.find((part) => part.type === "minute")?.value ?? "0", 10);

  if (!year || !month || !day) {
    throw new Error(`Unable to resolve timezone date parts for ${timeZone}`);
  }

  return {
    dateKey: `${year}-${month}-${day}`,
    hour,
    minute,
  };
}

const runAt = parseRunAt(RUN_AT);
const checkIntervalMs = Math.max(10, Number.isFinite(CHECK_INTERVAL_SECONDS) ? CHECK_INTERVAL_SECONDS : 60) * 1000;
const retryCooldownMs = Math.max(60, Number.isFinite(RETRY_COOLDOWN_SECONDS) ? RETRY_COOLDOWN_SECONDS : 900) * 1000;

let running = false;
let lastSuccessDateKey = "";
let lastAttemptAt = 0;

async function runCollection(trigger) {
  if (running) {
    return;
  }

  const now = Date.now();
  if (now - lastAttemptAt < retryCooldownMs) {
    return;
  }

  lastAttemptAt = now;
  running = true;

  try {
    const result = await collectDailyAiNews({ timeZone: TIMEZONE });
    lastSuccessDateKey = result.targetDateKey;
    console.log(
      `[ai-news] trigger=${trigger} date=${result.targetDateKey} fetched=${result.fetched} created=${result.created} updated=${result.updated} skipped=${result.skipped}`,
    );
  } catch (error) {
    console.error(`[ai-news] trigger=${trigger} failed:`, error);
  } finally {
    running = false;
  }
}

function shouldRunForToday(nowParts) {
  const reachedRunTime =
    nowParts.hour > runAt.hour ||
    (nowParts.hour === runAt.hour && nowParts.minute >= runAt.minute);

  return reachedRunTime && lastSuccessDateKey !== nowParts.dateKey;
}

async function tick() {
  try {
    const nowParts = getNowParts(TIMEZONE);
    if (shouldRunForToday(nowParts)) {
      await runCollection("scheduled");
    }
  } catch (error) {
    console.error("[ai-news] scheduler tick failed:", error);
  }
}

console.log(
  `[ai-news] scheduler started. timezone=${TIMEZONE} runAt=${runAt.hour.toString().padStart(2, "0")}:${runAt.minute
    .toString()
    .padStart(2, "0")}`,
);

if (RUN_ON_START) {
  void runCollection("startup");
}

void tick();
setInterval(() => {
  void tick();
}, checkIntervalMs);
