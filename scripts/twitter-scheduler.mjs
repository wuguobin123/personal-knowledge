import { collectLatestTweets, hasTwitterCollectionConfig } from "./twitter-collector.mjs";

const TIMEZONE = process.env.TWITTER_TIMEZONE || "Asia/Shanghai";
const RUN_AT = process.env.TWITTER_RUN_AT || "06:50";
const CHECK_INTERVAL_SECONDS = Number.parseInt(
  process.env.TWITTER_CHECK_INTERVAL_SECONDS ?? "60",
  10,
);
const RETRY_COOLDOWN_SECONDS = Number.parseInt(
  process.env.TWITTER_RETRY_COOLDOWN_SECONDS ?? "900",
  10,
);
const RUN_ON_START = process.env.TWITTER_RUN_ON_START === "true";

function parseRunAt(value) {
  const matched = String(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) {
    return { hour: 6, minute: 50 };
  }

  const hour = Number.parseInt(matched[1], 10);
  const minute = Number.parseInt(matched[2], 10);

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return { hour: 6, minute: 50 };
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
    const result = await collectLatestTweets({ timeZone: TIMEZONE });
    lastSuccessDateKey = getNowParts(TIMEZONE).dateKey;
    console.log(
      `[twitter] trigger=${trigger} accounts=${result.accounts} fetched=${result.fetched} created=${result.created} updated=${result.updated} skipped=${result.skipped}`,
    );
  } catch (error) {
    console.error(`[twitter] trigger=${trigger} failed:`, error);
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
    console.error("[twitter] scheduler tick failed:", error);
  }
}

const enabled = await hasTwitterCollectionConfig();

if (!enabled) {
  console.log("[twitter] scheduler disabled. Set SOCIALDATA_API_KEY and add watch accounts in admin to enable.");
} else {
  console.log(
    `[twitter] scheduler started. timezone=${TIMEZONE} runAt=${runAt.hour
      .toString()
      .padStart(2, "0")}:${runAt.minute.toString().padStart(2, "0")}`,
  );

  if (RUN_ON_START) {
    void runCollection("startup");
  }

  void tick();
  setInterval(() => {
    void tick();
  }, checkIntervalMs);
}
