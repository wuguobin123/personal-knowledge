import { PrismaClient } from "@prisma/client";

const DEFAULT_TIMEZONE = process.env.TWITTER_TIMEZONE || "Asia/Shanghai";
const DEFAULT_FETCH_TIMEOUT_MS = Number.parseInt(process.env.TWITTER_FETCH_TIMEOUT_MS ?? "15000", 10);
const DEFAULT_MAX_PAGES_PER_ACCOUNT = Number.parseInt(
  process.env.TWITTER_MAX_PAGES_PER_ACCOUNT ?? "3",
  10,
);
const DEFAULT_INITIAL_LOOKBACK_DAYS = Number.parseInt(
  process.env.TWITTER_INITIAL_LOOKBACK_DAYS ?? "2",
  10,
);
const DEFAULT_SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1";
const DEFAULT_SILICONFLOW_MODEL = "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B";
const DEFAULT_TRANSLATE_TIMEOUT_MS = Number.parseInt(
  process.env.TWITTER_TRANSLATE_TIMEOUT_MS ?? "45000",
  10,
);
const DEFAULT_TRANSLATE_BATCH_SIZE = Number.parseInt(
  process.env.TWITTER_TRANSLATE_BATCH_SIZE ?? "8",
  10,
);
const DEFAULT_USER_AGENT =
  process.env.TWITTER_USER_AGENT || "personal-knowledge-twitter-bot/1.0";

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function safeObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input;
}

function normalizeUsername(value) {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function parseUsernames(value) {
  const items = Array.isArray(value) ? value : String(value ?? "").split(/[,\n]/);
  const usernames = items.map(normalizeUsername).filter(Boolean);
  return Array.from(new Set(usernames));
}

function getConfiguredUsernames(input) {
  return parseUsernames(input ?? process.env.TWITTER_MONITOR_USERNAMES ?? "");
}

export async function hasTwitterCollectionConfig(input = {}) {
  const apiKey = String(process.env.SOCIALDATA_API_KEY || "").trim();
  if (!apiKey) {
    return false;
  }

  const usernames = getConfiguredUsernames(input?.usernames);
  if (usernames.length > 0) {
    return true;
  }

  const prisma = new PrismaClient();
  try {
    const enabledCount = await prisma.twitterWatchAccount.count({
      where: {
        enabled: true,
      },
    });

    return enabledCount > 0;
  } finally {
    await prisma.$disconnect();
  }
}

function getDateKey(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Unable to format date for timezone ${timeZone}`);
  }

  return `${year}-${month}-${day}`;
}

function getLookbackDateKey(days, timeZone) {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() - Math.max(1, days));
  return getDateKey(base, timeZone);
}

function parseDate(value) {
  const parsed = new Date(String(value ?? ""));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function toNullableNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareIdStrings(left, right) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;

  try {
    const leftBigInt = BigInt(left);
    const rightBigInt = BigInt(right);
    if (leftBigInt === rightBigInt) return 0;
    return leftBigInt > rightBigInt ? 1 : -1;
  } catch {
    if (left === right) return 0;
    return left > right ? 1 : -1;
  }
}

function getHigherId(left, right) {
  return compareIdStrings(left, right) >= 0 ? left : right;
}

function stripFence(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    return trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  return trimmed;
}

function parseJsonArray(raw) {
  const cleaned = stripFence(raw);
  if (!cleaned) {
    return null;
  }

  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    const matched = cleaned.match(/\[[\s\S]*\]/);
    if (!matched) {
      return null;
    }

    try {
      const parsed = JSON.parse(matched[0]);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function getSiliconFlowConfig() {
  const apiKey = String(process.env.SILICONFLOW_API_KEY || "").trim();
  if (!apiKey) {
    return null;
  }

  const baseUrl = String(process.env.SILICONFLOW_BASE_URL || DEFAULT_SILICONFLOW_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
  const model = String(process.env.SILICONFLOW_MODEL || DEFAULT_SILICONFLOW_MODEL).trim();

  return {
    apiKey,
    baseUrl,
    model,
  };
}

async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs: customTimeoutMs, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutMs = toPositiveInt(customTimeoutMs, DEFAULT_FETCH_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": DEFAULT_USER_AGENT,
        ...(fetchOptions.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Request failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`);
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function getCollectorConfig(options = {}) {
  const apiKey = String(process.env.SOCIALDATA_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("SOCIALDATA_API_KEY is missing.");
  }

  return {
    apiKey,
    explicitUsernames:
      options.usernames === undefined ? [] : getConfiguredUsernames(options.usernames),
    bootstrapUsernames: getConfiguredUsernames(),
    timeZone: options.timeZone || process.env.TWITTER_TIMEZONE || DEFAULT_TIMEZONE,
    includeReplies: toBoolean(options.includeReplies ?? process.env.TWITTER_INCLUDE_REPLIES, false),
    includeRetweets: toBoolean(options.includeRetweets ?? process.env.TWITTER_INCLUDE_RETWEETS, false),
    maxPagesPerAccount: Math.min(
      10,
      toPositiveInt(options.maxPagesPerAccount ?? process.env.TWITTER_MAX_PAGES_PER_ACCOUNT, DEFAULT_MAX_PAGES_PER_ACCOUNT),
    ),
    initialLookbackDays: Math.min(
      30,
      toPositiveInt(
        options.initialLookbackDays ?? process.env.TWITTER_INITIAL_LOOKBACK_DAYS,
        DEFAULT_INITIAL_LOOKBACK_DAYS,
      ),
    ),
  };
}

async function fetchUserProfile(username, config) {
  const response = await fetchWithTimeout(
    `https://api.socialdata.tools/twitter/user/${encodeURIComponent(username)}`,
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    },
  );

  return response.json();
}

async function searchTweets(query, config, cursor) {
  const url = new URL("https://api.socialdata.tools/twitter/search");
  url.searchParams.set("query", query);
  url.searchParams.set("type", "Latest");
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }

  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  });

  return response.json();
}

function extractTweets(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.tweets)) {
    return payload.tweets;
  }
  if (Array.isArray(payload?.result?.tweets)) {
    return payload.result.tweets;
  }
  if (Array.isArray(payload?.results)) {
    return payload.results;
  }
  return [];
}

function buildSearchQuery(account, config) {
  const parts = [`from:${account.username}`];

  if (!account.includeReplies) {
    parts.push("-filter:replies");
  }
  if (!account.includeRetweets) {
    parts.push("-filter:retweets");
  }
  if (account.lastSinceId) {
    parts.push(`since_id:${account.lastSinceId}`);
  } else if (config.initialLookbackDays > 0) {
    parts.push(`since:${getLookbackDateKey(config.initialLookbackDays, config.timeZone)}`);
  }

  return parts.join(" ");
}

function normalizeTweet(rawTweet, watchAccountId) {
  const tweet = safeObject(rawTweet);
  const userResult = safeObject(tweet.user_results?.result);
  const userLegacy = safeObject(userResult.legacy);
  const user = safeObject(tweet.user);
  const author = safeObject(tweet.author);
  const resolvedUser =
    Object.keys(user).length > 0
      ? user
      : Object.keys(userLegacy).length > 0
        ? userLegacy
        : author;
  const tweetIdStr = String(tweet.id_str ?? tweet.id ?? "").trim();
  const username = normalizeUsername(
    resolvedUser.screen_name ?? tweet.screen_name ?? tweet.user_screen_name ?? tweet.username,
  );
  const userIdStr = String(
    resolvedUser.id_str ??
      resolvedUser.rest_id ??
      resolvedUser.id ??
      tweet.user_id_str ??
      tweet.user_id ??
      "",
  ).trim();
  const tweetCreatedAt = parseDate(tweet.tweet_created_at ?? tweet.created_at ?? tweet.created_at_iso);

  if (!tweetIdStr || !username || !userIdStr || !tweetCreatedAt) {
    return null;
  }

  return {
    tweetIdStr,
    watchAccountId,
    userIdStr,
    username,
    fullText: String(tweet.full_text ?? tweet.note_tweet?.text ?? tweet.text ?? "").trim() || null,
    url: `https://x.com/${username}/status/${tweetIdStr}`,
    lang: String(tweet.lang ?? "").trim() || null,
    conversationId: String(tweet.conversation_id_str ?? tweet.conversation_id ?? "").trim() || null,
    tweetCreatedAt,
    replyCount: toNullableNumber(tweet.reply_count),
    retweetCount: toNullableNumber(tweet.retweet_count),
    favoriteCount: toNullableNumber(tweet.favorite_count),
    quoteCount: toNullableNumber(tweet.quote_count),
    bookmarkCount: toNullableNumber(tweet.bookmark_count),
    viewsCount: toNullableNumber(tweet.views_count),
    raw: tweet,
  };
}

function dedupeTweets(items) {
  const map = new Map();

  for (const item of items) {
    if (!item?.tweetIdStr) {
      continue;
    }
    if (!map.has(item.tweetIdStr)) {
      map.set(item.tweetIdStr, item);
    }
  }

  return Array.from(map.values());
}

async function runTranslationBatch(chunk, config) {
  const chatUrl = `${config.baseUrl}/chat/completions`;
  const translateTimeoutMs = toPositiveInt(
    process.env.TWITTER_TRANSLATE_TIMEOUT_MS,
    DEFAULT_TRANSLATE_TIMEOUT_MS,
  );
  const normalizedChunk = chunk.map((item, idx) => ({
    idx,
    username: item.username,
    text: String(item.fullText || ""),
    lang: String(item.lang || ""),
  }));

  const systemPrompt = [
    "你是专业的推文翻译编辑。",
    "请把输入的推文内容翻译为自然、准确、简洁的中文。",
    "不要编造原文没有的信息，不要添加解释或评论。",
    "尽量保留 @用户名、#标签、URL、换行结构与语气。",
    "如果原文已经是中文，只做最轻微整理。",
    "返回严格 JSON 数组；每个元素只允许包含 idx 和 translatedText 两个字段。",
  ].join("\n");

  const response = await fetchWithTimeout(chatUrl, {
    timeoutMs: translateTimeoutMs,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(normalizedChunk) },
      ],
    }),
  });

  const payload = await response.json();
  const rawContent = payload?.choices?.[0]?.message?.content;
  const parsed = parseJsonArray(rawContent);
  if (!parsed) {
    throw new Error("Model response is not a valid JSON array.");
  }

  return parsed
    .map((entry) => {
      const idx = Number.parseInt(String(entry?.idx ?? ""), 10);
      const translatedText = String(entry?.translatedText ?? "").trim();

      if (!Number.isFinite(idx) || idx < 0 || idx >= chunk.length || !translatedText) {
        return null;
      }

      return { idx, translatedText };
    })
    .filter((entry) => entry != null);
}

async function localizeTweetsToChinese(tweets) {
  if (!Array.isArray(tweets) || tweets.length === 0) {
    return tweets;
  }

  const config = getSiliconFlowConfig();
  if (!config) {
    console.warn("[twitter] SILICONFLOW_API_KEY is missing, skip Chinese localization.");
    return tweets;
  }

  const batchSize = Math.min(
    20,
    Math.max(1, toPositiveInt(process.env.TWITTER_TRANSLATE_BATCH_SIZE, DEFAULT_TRANSLATE_BATCH_SIZE)),
  );
  const localizedTweets = [];

  for (let start = 0; start < tweets.length; start += batchSize) {
    const chunk = tweets.slice(start, start + batchSize);
    const translatableChunk = chunk.filter((item) => String(item.fullText || "").trim());

    if (translatableChunk.length === 0) {
      localizedTweets.push(...chunk);
      continue;
    }

    try {
      const batchResult = await runTranslationBatch(translatableChunk, config);
      const localizedByIndex = new Map(batchResult.map((entry) => [entry.idx, entry.translatedText]));

      for (let index = 0; index < translatableChunk.length; index += 1) {
        const item = translatableChunk[index];
        const translatedText = localizedByIndex.get(index);
        const raw = safeObject(item.raw);

        localizedTweets.push({
          ...item,
          translatedText: translatedText || item.translatedText || null,
          translationModel: translatedText ? config.model : item.translationModel || null,
          translatedAt: translatedText ? new Date() : item.translatedAt || null,
          raw: {
            ...raw,
            localization: {
              localizedTo: "zh",
              model: config.model,
              status: translatedText ? "ok" : "partial",
            },
          },
        });
      }

      const untranslated = chunk.filter((item) => !String(item.fullText || "").trim());
      localizedTweets.push(...untranslated);
    } catch (error) {
      console.error("[twitter] Chinese localization batch failed:", error.message);
      localizedTweets.push(...chunk);
    }
  }

  return dedupeTweets(localizedTweets);
}

async function syncWatchAccounts(prisma, config) {
  const syncedAccounts = [];

  for (const username of config.usernames) {
    let profile = null;

    try {
      profile = await fetchUserProfile(username, config);
    } catch (error) {
      console.error(`[twitter] profile sync failed for @${username}:`, error.message);
    }

    const profileRecord = safeObject(profile?.result ?? profile);

    const row = await prisma.twitterWatchAccount.upsert({
      where: { username },
      update: {
        userIdStr: String(profileRecord.id_str ?? "").trim() || undefined,
        enabled: true,
        includeReplies: config.includeReplies,
        includeRetweets: config.includeRetweets,
        lastProfileSyncedAt: Object.keys(profileRecord).length > 0 ? new Date() : undefined,
      },
      create: {
        username,
        userIdStr: String(profileRecord.id_str ?? "").trim() || null,
        enabled: true,
        includeReplies: config.includeReplies,
        includeRetweets: config.includeRetweets,
        lastProfileSyncedAt: Object.keys(profileRecord).length > 0 ? new Date() : null,
      },
      select: {
        id: true,
        username: true,
        userIdStr: true,
        lastSinceId: true,
        includeReplies: true,
        includeRetweets: true,
      },
    });

    syncedAccounts.push(row);
  }

  return syncedAccounts;
}

async function resolveWatchAccounts(prisma, config) {
  if (config.explicitUsernames.length > 0) {
    return syncWatchAccounts(prisma, {
      ...config,
      usernames: config.explicitUsernames,
    });
  }

  const existingAccounts = await prisma.twitterWatchAccount.findMany({
    where: {
      enabled: true,
    },
    orderBy: {
      username: "asc",
    },
    select: {
      id: true,
      username: true,
      userIdStr: true,
      lastSinceId: true,
      includeReplies: true,
      includeRetweets: true,
    },
  });

  if (existingAccounts.length > 0) {
    return existingAccounts;
  }

  if (config.bootstrapUsernames.length > 0) {
    return syncWatchAccounts(prisma, {
      ...config,
      usernames: config.bootstrapUsernames,
    });
  }

  throw new Error("No enabled Twitter watch accounts configured.");
}

async function fetchTweetsForAccount(account, config) {
  const query = buildSearchQuery(account, config);
  const collected = [];
  let cursor = "";
  let page = 0;

  while (page < config.maxPagesPerAccount) {
    const payload = await searchTweets(query, config, cursor);
    const normalizedTweets = extractTweets(payload)
      .map((tweet) => normalizeTweet(tweet, account.id))
      .filter((tweet) => tweet != null);

    if (normalizedTweets.length === 0) {
      break;
    }

    collected.push(...normalizedTweets);
    cursor = String(payload?.next_cursor ?? "").trim();
    page += 1;

    if (!cursor) {
      break;
    }
  }

  return dedupeTweets(collected);
}

async function persistTweets(prisma, account, tweets) {
  const stats = {
    fetched: tweets.length,
    created: 0,
    updated: 0,
    skipped: 0,
  };

  if (tweets.length === 0) {
    await prisma.twitterWatchAccount.update({
      where: { id: account.id },
      data: {
        lastSyncedAt: new Date(),
      },
    });

    return {
      ...stats,
      highestSinceId: account.lastSinceId || null,
    };
  }

  const tweetIds = tweets.map((tweet) => tweet.tweetIdStr);
  const existingRows = await prisma.twitterPost.findMany({
    where: {
      tweetIdStr: {
        in: tweetIds,
      },
    },
    select: {
      id: true,
      tweetIdStr: true,
    },
  });
  const existingByTweetId = new Map(existingRows.map((row) => [row.tweetIdStr, row.id]));
  let highestSinceId = account.lastSinceId || null;

  for (const tweet of tweets) {
    try {
      const data = {
        watchAccountId: account.id,
        userIdStr: tweet.userIdStr,
        username: tweet.username,
        fullText: tweet.fullText,
        translatedText: tweet.translatedText ?? null,
        translationModel: tweet.translationModel ?? null,
        url: tweet.url,
        lang: tweet.lang,
        conversationId: tweet.conversationId,
        tweetCreatedAt: tweet.tweetCreatedAt,
        fetchedAt: new Date(),
        translatedAt: tweet.translatedAt ?? null,
        replyCount: tweet.replyCount,
        retweetCount: tweet.retweetCount,
        favoriteCount: tweet.favoriteCount,
        quoteCount: tweet.quoteCount,
        bookmarkCount: tweet.bookmarkCount,
        viewsCount: tweet.viewsCount,
        raw: tweet.raw ?? null,
      };

      const existingId = existingByTweetId.get(tweet.tweetIdStr);
      if (existingId) {
        await prisma.twitterPost.update({
          where: { id: existingId },
          data,
        });
        stats.updated += 1;
      } else {
        await prisma.twitterPost.create({
          data: {
            tweetIdStr: tweet.tweetIdStr,
            ...data,
          },
        });
        stats.created += 1;
      }

      highestSinceId = getHigherId(highestSinceId, tweet.tweetIdStr);
    } catch (error) {
      stats.skipped += 1;
      console.error(`[twitter] Skip tweet @${account.username} ${tweet.tweetIdStr}:`, error.message);
    }
  }

  await prisma.twitterWatchAccount.update({
    where: { id: account.id },
    data: {
      lastSinceId: highestSinceId,
      lastSyncedAt: new Date(),
    },
  });

  return {
    ...stats,
    highestSinceId,
  };
}

export async function collectLatestTweets(options = {}) {
  const config = getCollectorConfig(options);
  const prisma = new PrismaClient();

  try {
    const accounts = await resolveWatchAccounts(prisma, config);
    const perAccount = [];
    const totals = {
      accounts: accounts.length,
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
    };

    for (const account of accounts) {
      try {
        const tweets = await fetchTweetsForAccount(account, config);
        const localizedTweets = await localizeTweetsToChinese(tweets);
        const stats = await persistTweets(prisma, account, localizedTweets);

        perAccount.push({
          username: account.username,
          fetched: stats.fetched,
          created: stats.created,
          updated: stats.updated,
          skipped: stats.skipped,
          highestSinceId: stats.highestSinceId,
        });

        totals.fetched += stats.fetched;
        totals.created += stats.created;
        totals.updated += stats.updated;
        totals.skipped += stats.skipped;
      } catch (error) {
        totals.skipped += 1;
        perAccount.push({
          username: account.username,
          fetched: 0,
          created: 0,
          updated: 0,
          skipped: 1,
          error: error.message,
        });
        console.error(`[twitter] account sync failed for @${account.username}:`, error.message);
      }
    }

    return {
      timeZone: config.timeZone,
      usernames: accounts.map((account) => account.username),
      ...totals,
      perAccount,
    };
  } finally {
    await prisma.$disconnect();
  }
}
