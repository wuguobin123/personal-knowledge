import { PrismaClient } from "@prisma/client";

const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.AI_NEWS_FETCH_TIMEOUT_MS ?? "15000", 10);
const DEFAULT_MAX_NEWS_ITEMS = Number.parseInt(process.env.AI_NEWS_MAX_NEWS_ITEMS ?? "25", 10);
const DEFAULT_MAX_GITHUB_ITEMS = Number.parseInt(process.env.AI_NEWS_MAX_GITHUB_ITEMS ?? "20", 10);
const DEFAULT_TIMEZONE = process.env.AI_NEWS_TIMEZONE || "Asia/Shanghai";
const DEFAULT_USER_AGENT =
  process.env.AI_NEWS_USER_AGENT || "personal-knowledge-ai-news-bot/1.0";
const DEFAULT_SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1";
const DEFAULT_SILICONFLOW_MODEL = "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B";
const DEFAULT_TRANSLATE_TIMEOUT_MS = Number.parseInt(
  process.env.AI_NEWS_TRANSLATE_TIMEOUT_MS ?? "45000",
  10,
);
const DEFAULT_TRANSLATE_BATCH_SIZE = Number.parseInt(
  process.env.AI_NEWS_TRANSLATE_BATCH_SIZE ?? "8",
  10,
);
const DEFAULT_GITHUB_HIGH_STAR_THRESHOLD = Number.parseInt(
  process.env.AI_NEWS_GITHUB_HIGH_STAR_THRESHOLD ?? "200",
  10,
);

const XML_ENTITY_MAP = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
};

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function decodeXmlEntities(text) {
  if (!text) {
    return "";
  }

  let decoded = String(text);
  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
    const codePoint = Number.parseInt(hex, 16);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
  });
  decoded = decoded.replace(/&#([0-9]+);/g, (_, num) => {
    const codePoint = Number.parseInt(num, 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
  });

  for (const [entity, value] of Object.entries(XML_ENTITY_MAP)) {
    decoded = decoded.split(entity).join(value);
  }

  return decoded;
}

function stripHtml(input) {
  if (!input) {
    return "";
  }

  return decodeXmlEntities(
    String(input)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function limitText(input, maxLength) {
  const text = String(input ?? "").trim();
  if (text.length <= maxLength) {
    return text;
  }
  if (maxLength <= 3) {
    return text.slice(0, maxLength);
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function safeObject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  return input;
}

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalize36KrRoute(route, itemId) {
  const routeValue = String(route ?? "").trim();
  const routeItemId = routeValue.match(/itemId=(\d+)/)?.[1];
  const finalId = String(routeItemId || itemId || "").trim();
  if (finalId) {
    return `https://36kr.com/p/${finalId}`;
  }
  if (!routeValue) {
    return "";
  }
  if (routeValue.startsWith("http://") || routeValue.startsWith("https://")) {
    return routeValue;
  }
  return `https://36kr.com/${routeValue.replace(/^\/+/, "")}`;
}

function containsAiKeyword(input) {
  const text = String(input ?? "").toLowerCase();
  if (!text) {
    return false;
  }

  return (
    /(^|[^a-z])(ai|llm|gpt|openai|anthropic|claude|gemini|deepseek|copilot|mistral|agent)([^a-z]|$)/i.test(
      text,
    ) || /人工智能|大模型|机器学习|生成式|智能体|算力|模型|deepseek|openai|claude|gemini/.test(text)
  );
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

function normalizeUrl(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) {
    return "";
  }

  try {
    const parsed = new URL(value);
    parsed.hash = "";

    const removableParams = [];
    for (const key of parsed.searchParams.keys()) {
      if (key.toLowerCase().startsWith("utm_")) {
        removableParams.push(key);
      }
    }

    for (const key of removableParams) {
      parsed.searchParams.delete(key);
    }

    return parsed.toString();
  } catch {
    return value;
  }
}

function parseRssItems(xmlText) {
  const items = [];
  const matches = xmlText.matchAll(/<item\b[\s\S]*?<\/item>/gi);

  for (const match of matches) {
    const itemBlock = match[0];

    const extract = (tag) => {
      const regex = new RegExp(`<${tag}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
      const value = itemBlock.match(regex)?.[1] ?? "";
      return decodeXmlEntities(value.trim());
    };

    items.push({
      title: stripHtml(extract("title")),
      link: extract("link").trim(),
      pubDate: extract("pubDate").trim(),
      description: stripHtml(extract("description")),
      guid: extract("guid").trim(),
    });
  }

  return items;
}

async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs: customTimeoutMs, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutMs = toPositiveInt(
    customTimeoutMs,
    toPositiveInt(process.env.AI_NEWS_FETCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  );
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        ...(fetchOptions.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`);
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
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

async function runLocalizationBatch(chunk, config, highStarThreshold) {
  const chatUrl = `${config.baseUrl}/chat/completions`;
  const translateTimeoutMs = toPositiveInt(
    process.env.AI_NEWS_TRANSLATE_TIMEOUT_MS,
    DEFAULT_TRANSLATE_TIMEOUT_MS,
  );
  const normalizedChunk = chunk.map((item, idx) => ({
    idx,
    title: String(item.title || ""),
    summary: String(item.summary || item.title || ""),
    source: String(item.source || ""),
    category: String(item.category || ""),
    stars: Number.isFinite(item.stars) ? item.stars : null,
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 10) : [],
  }));

  const systemPrompt = [
    "你是科技新闻编辑。",
    "请把输入新闻的标题和摘要改写为自然、准确、简洁的中文。",
    `高星 GitHub 项目定义：stars >= ${highStarThreshold}。`,
    "如果是高星 GitHub 项目，摘要第一句必须明确写出该项目具体用来做什么、解决什么问题。",
    "仅可基于输入信息，不要编造不存在的事实。",
    "返回严格 JSON 数组；每个元素只允许包含 idx、title、summary 三个字段。",
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
      const title = String(entry?.title ?? "").trim();
      const summary = String(entry?.summary ?? "").trim();

      if (!Number.isFinite(idx) || idx < 0 || idx >= chunk.length || !title || !summary) {
        return null;
      }

      return { idx, title, summary };
    })
    .filter((entry) => entry != null);
}

async function localizeItemsToChinese(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return items;
  }

  const config = getSiliconFlowConfig();
  if (!config) {
    console.warn("[ai-news] SILICONFLOW_API_KEY is missing, skip Chinese localization.");
    return items;
  }

  const batchSize = Math.min(
    20,
    Math.max(1, toPositiveInt(process.env.AI_NEWS_TRANSLATE_BATCH_SIZE, DEFAULT_TRANSLATE_BATCH_SIZE)),
  );
  const highStarThreshold = toPositiveInt(
    process.env.AI_NEWS_GITHUB_HIGH_STAR_THRESHOLD,
    DEFAULT_GITHUB_HIGH_STAR_THRESHOLD,
  );

  const localizedItems = [];

  for (let start = 0; start < items.length; start += batchSize) {
    const chunk = items.slice(start, start + batchSize);
    try {
      const batchResult = await runLocalizationBatch(chunk, config, highStarThreshold);
      const localizedByIndex = new Map(batchResult.map((entry) => [entry.idx, entry]));

      for (let index = 0; index < chunk.length; index += 1) {
        const item = chunk[index];
        const localized = localizedByIndex.get(index);
        const raw = safeObject(item.raw);
        const isHighStarGithub =
          item.category === "GITHUB_PROJECT" &&
          Number.isFinite(item.stars) &&
          item.stars >= highStarThreshold;

        if (!localized) {
          localizedItems.push({
            ...item,
            raw: {
              ...raw,
              localization: {
                localizedTo: "zh",
                model: config.model,
                status: "partial",
                highStarThreshold,
                highStarGithub: isHighStarGithub,
              },
            },
          });
          continue;
        }

        localizedItems.push({
          ...item,
          title: limitText(localized.title, 300),
          summary: limitText(localized.summary, 1000),
          raw: {
            ...raw,
            localization: {
              localizedTo: "zh",
              model: config.model,
              status: "ok",
              highStarThreshold,
              highStarGithub: isHighStarGithub,
            },
          },
        });
      }
    } catch (error) {
      console.error("[ai-news] Chinese localization batch failed:", error.message);
      localizedItems.push(...chunk);
    }
  }

  return localizedItems;
}

async function fetchGoogleNews(targetDateKey, timeZone) {
  const feeds = [
    {
      source: "GoogleNews",
      category: "MODEL_RELEASE",
      language: "en",
      query: "new AI model release when:1d",
      hl: "en-US",
      gl: "US",
      ceid: "US:en",
    },
    {
      source: "GoogleNews",
      category: "GENERAL_NEWS",
      language: "zh",
      query: "latest artificial intelligence news when:1d",
      hl: "en-US",
      gl: "US",
      ceid: "US:en",
    },
  ];

  const items = [];
  for (const feed of feeds) {
    const feedUrl =
      `https://news.google.com/rss/search?q=${encodeURIComponent(feed.query)}` +
      `&hl=${encodeURIComponent(feed.hl)}` +
      `&gl=${encodeURIComponent(feed.gl)}` +
      `&ceid=${encodeURIComponent(feed.ceid)}`;

    try {
      const response = await fetchWithTimeout(feedUrl);
      const xml = await response.text();
      const parsedItems = parseRssItems(xml);

      for (const entry of parsedItems) {
        const entryDate = entry.pubDate ? new Date(entry.pubDate) : null;
        const hasValidEntryDate = entryDate instanceof Date && Number.isFinite(entryDate.getTime());
        if (hasValidEntryDate && getDateKey(entryDate, timeZone) !== targetDateKey) {
          continue;
        }

        const normalizedUrl = normalizeUrl(entry.link);
        if (!entry.title || !normalizedUrl) {
          continue;
        }

        items.push({
          title: limitText(entry.title, 300),
          summary: limitText(entry.description || entry.title, 1000),
          url: normalizedUrl,
          source: feed.source,
          category: feed.category,
          externalId: limitText(entry.guid || normalizedUrl, 191),
          language: feed.language,
          stars: null,
          tags: ["ai", "news"],
          raw: {
            query: feed.query,
            publishedAt: entry.pubDate,
          },
        });
      }
    } catch (error) {
      console.error(`[ai-news] Google News fetch failed for query "${feed.query}":`, error.message);
    }
  }

  return items;
}

async function fetchHackerNews(targetDateKey, timeZone) {
  const latestQueries = [
    { keyword: "new AI model", category: "MODEL_RELEASE", ranking: "latest" },
    { keyword: "open source AI", category: "GENERAL_NEWS", ranking: "latest" },
    { keyword: "AI agent", category: "GENERAL_NEWS", ranking: "latest" },
  ];
  const hotQueries = [
    { keyword: "AI", category: "GENERAL_NEWS", ranking: "hot" },
    { keyword: "LLM", category: "GENERAL_NEWS", ranking: "hot" },
    { keyword: "OpenAI", category: "GENERAL_NEWS", ranking: "hot" },
  ];

  const items = [];

  for (const query of [...latestQueries, ...hotQueries]) {
    const endpoint =
      query.ranking === "hot"
        ? "https://hn.algolia.com/api/v1/search"
        : "https://hn.algolia.com/api/v1/search_by_date";
    const url =
      `${endpoint}?tags=story&hitsPerPage=40&query=${encodeURIComponent(query.keyword)}`;

    try {
      const response = await fetchWithTimeout(url);
      const payload = await response.json();
      const hits = Array.isArray(payload?.hits) ? payload.hits : [];

      for (const hit of hits) {
        const createdAt = hit?.created_at ? new Date(hit.created_at) : null;
        const hasValidCreatedAt = createdAt instanceof Date && Number.isFinite(createdAt.getTime());
        if (hasValidCreatedAt && getDateKey(createdAt, timeZone) !== targetDateKey) {
          continue;
        }

        const title = stripHtml(hit?.title || hit?.story_title || "");
        const rawUrl = hit?.url || hit?.story_url;
        const normalizedUrl = normalizeUrl(rawUrl);
        if (!title || !normalizedUrl) {
          continue;
        }

        const summary = stripHtml(hit?.story_text || hit?.comment_text || title);
        if (!containsAiKeyword(`${title} ${summary}`)) {
          continue;
        }

        items.push({
          title: limitText(title, 300),
          summary: limitText(summary || title, 1000),
          url: normalizedUrl,
          source: "HackerNews",
          category: query.category,
          externalId: limitText(String(hit?.objectID || normalizedUrl), 191),
          language: "en",
          stars: null,
          tags: ["ai", "hn"],
          raw: {
            points: hit?.points ?? null,
            comments: hit?.num_comments ?? null,
            author: hit?.author ?? null,
            createdAt: hit?.created_at ?? null,
            ranking: query.ranking,
            keyword: query.keyword,
          },
        });
      }
    } catch (error) {
      console.error(`[ai-news] Hacker News fetch failed for query "${query.keyword}":`, error.message);
    }
  }

  try {
    const topIdsResponse = await fetchWithTimeout(
      "https://hacker-news.firebaseio.com/v0/topstories.json",
    );
    const topIdsPayload = await topIdsResponse.json();
    const topIds = Array.isArray(topIdsPayload) ? topIdsPayload.slice(0, 60) : [];

    const detailResults = await Promise.all(
      topIds.map(async (id) => {
        try {
          const detailResp = await fetchWithTimeout(
            `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
          );
          return detailResp.json();
        } catch {
          return null;
        }
      }),
    );

    for (const story of detailResults) {
      if (!story || story.type !== "story") {
        continue;
      }

      const title = stripHtml(story.title || "");
      const normalizedUrl = normalizeUrl(story.url);
      if (!title || !normalizedUrl) {
        continue;
      }

      if (!containsAiKeyword(title)) {
        continue;
      }

      const createdAt =
        Number.isFinite(story.time) && story.time > 0 ? new Date(story.time * 1000) : null;
      const hasValidCreatedAt = createdAt instanceof Date && Number.isFinite(createdAt.getTime());
      if (hasValidCreatedAt && getDateKey(createdAt, timeZone) !== targetDateKey) {
        continue;
      }

      const points = Number.isFinite(story.score) ? story.score : null;
      const comments = Number.isFinite(story.descendants) ? story.descendants : null;
      const summary = `HN 热点：${title}（${points ?? 0} 分，${comments ?? 0} 评论）`;

      items.push({
        title: limitText(title, 300),
        summary: limitText(summary, 1000),
        url: normalizedUrl,
        source: "HackerNews",
        category: /model|gpt|llm|claude|gemini|deepseek/i.test(title)
          ? "MODEL_RELEASE"
          : "GENERAL_NEWS",
        externalId: limitText(String(story.id || normalizedUrl), 191),
        language: "en",
        stars: null,
        tags: ["ai", "hn", "hot"],
        raw: {
          points,
          comments,
          author: story.by ?? null,
          createdAt: hasValidCreatedAt ? createdAt.toISOString() : null,
          ranking: "topstories",
        },
      });
    }
  } catch (error) {
    console.error("[ai-news] Hacker News top stories fetch failed:", error.message);
  }

  return items;
}

async function fetch36KrAiNews(targetDateKey, timeZone) {
  const url = "https://36kr.com/information/AI";

  try {
    const response = await fetchWithTimeout(url);
    const html = await response.text();
    const stateMatch = html.match(/<script\s+async>\s*window\.initialState=(\{[\s\S]*?\})<\/script>/i);

    if (!stateMatch?.[1]) {
      return [];
    }

    const state = safeParseJson(stateMatch[1]);
    const itemList = Array.isArray(state?.information?.informationList?.itemList)
      ? state.information.informationList.itemList
      : [];

    const items = [];
    for (const entry of itemList) {
      const material = safeObject(entry?.templateMaterial);
      const title = stripHtml(material.widgetTitle || "");
      const summary = stripHtml(material.summary || title);
      const itemId = entry?.itemId ?? material.itemId ?? null;
      const normalizedUrl = normalizeUrl(normalize36KrRoute(entry?.route, itemId));

      if (!title || !normalizedUrl) {
        continue;
      }

      const publishTime = Number(material.publishTime);
      const publishedAt = Number.isFinite(publishTime) && publishTime > 0 ? new Date(publishTime) : null;
      const hasValidPublishedAt = publishedAt instanceof Date && Number.isFinite(publishedAt.getTime());
      if (hasValidPublishedAt && getDateKey(publishedAt, timeZone) !== targetDateKey) {
        continue;
      }

      items.push({
        title: limitText(title, 300),
        summary: limitText(summary || title, 1000),
        url: normalizedUrl,
        source: "36Kr",
        category: "GENERAL_NEWS",
        externalId: limitText(String(itemId || normalizedUrl), 191),
        language: "zh",
        stars: null,
        tags: ["ai", "36kr", "hot"],
        raw: {
          author: material.authorName ?? null,
          publishedAt: hasValidPublishedAt ? publishedAt.toISOString() : null,
          channel: "information/AI",
        },
      });
    }

    return items;
  } catch (error) {
    console.error("[ai-news] 36Kr AI fetch failed:", error.message);
    return [];
  }
}

async function fetchGitHubProjects(targetDateKey) {
  const token = process.env.GITHUB_TOKEN?.trim();
  const searchQuery = `topic:ai created:>=${targetDateKey} stars:>=50`;
  const url =
    "https://api.github.com/search/repositories" +
    `?q=${encodeURIComponent(searchQuery)}` +
    "&sort=stars&order=desc&per_page=30";

  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    const payload = await response.json();
    const repos = Array.isArray(payload?.items) ? payload.items : [];

    return repos.map((repo) => ({
      title: limitText(repo.full_name || repo.name || "Untitled", 300),
      summary: limitText(
        `${repo.description || "No description"} | Stars: ${repo.stargazers_count ?? 0}`,
        1000,
      ),
      url: normalizeUrl(repo.html_url),
      source: "GitHub",
      category: "GITHUB_PROJECT",
      externalId: limitText(repo.full_name || repo.id, 191),
      language: repo.language ? String(repo.language).slice(0, 20) : null,
      stars: Number.isFinite(repo.stargazers_count) ? repo.stargazers_count : null,
      tags: Array.isArray(repo.topics) ? repo.topics.slice(0, 10) : ["ai", "github"],
      raw: {
        createdAt: repo.created_at,
        updatedAt: repo.updated_at,
        forks: repo.forks_count,
        openIssues: repo.open_issues_count,
      },
    }));
  } catch (error) {
    console.error("[ai-news] GitHub fetch failed:", error.message);
    return [];
  }
}

function dedupeItems(items) {
  const map = new Map();

  for (const item of items) {
    const url = String(item?.url ?? "").trim();
    const source = String(item?.source ?? "").trim();
    if (!item?.title || !url || !source) {
      continue;
    }

    if (url.length > 500 || source.length > 80) {
      continue;
    }

    const key = `${source}::${url}`;
    if (!map.has(key)) {
      map.set(key, {
        ...item,
        source,
        url,
      });
    }
  }

  return Array.from(map.values());
}

function toNewsDate(dateKey) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

async function persistItems(prisma, targetDateKey, items) {
  const stats = {
    created: 0,
    updated: 0,
    skipped: 0,
  };

  const newsDate = toNewsDate(targetDateKey);

  for (const item of items) {
    try {
      const where = {
        source_url: {
          source: item.source,
          url: item.url,
        },
      };

      const existing = await prisma.aiNewsItem.findUnique({
        where,
        select: { id: true },
      });

      const data = {
        title: limitText(item.title, 300),
        summary: item.summary ? limitText(item.summary, 1000) : null,
        category: item.category,
        externalId: item.externalId ? limitText(item.externalId, 191) : null,
        stars: Number.isFinite(item.stars) ? item.stars : null,
        language: item.language ? limitText(item.language, 20) : null,
        tags: Array.isArray(item.tags) && item.tags.length > 0 ? item.tags : null,
        newsDate,
        fetchedAt: new Date(),
        raw: item.raw ?? null,
      };

      if (existing) {
        await prisma.aiNewsItem.update({
          where: { id: existing.id },
          data,
        });
        stats.updated += 1;
        continue;
      }

      await prisma.aiNewsItem.create({
        data: {
          ...data,
          source: item.source,
          url: item.url,
        },
      });
      stats.created += 1;
    } catch (error) {
      stats.skipped += 1;
      console.error(`[ai-news] Skip item source=${item.source} url=${item.url}:`, error.message);
    }
  }

  return stats;
}

export async function collectDailyAiNews(options = {}) {
  const timeZone = options.timeZone || DEFAULT_TIMEZONE;
  const targetDateKey = options.targetDateKey || getDateKey(new Date(), timeZone);
  const maxNewsItems = toPositiveInt(process.env.AI_NEWS_MAX_NEWS_ITEMS, DEFAULT_MAX_NEWS_ITEMS);
  const maxGithubItems = toPositiveInt(process.env.AI_NEWS_MAX_GITHUB_ITEMS, DEFAULT_MAX_GITHUB_ITEMS);

  const prisma = new PrismaClient();

  try {
    const [googleNews, hackerNews, kr36News, githubRepos] = await Promise.all([
      fetchGoogleNews(targetDateKey, timeZone),
      fetchHackerNews(targetDateKey, timeZone),
      fetch36KrAiNews(targetDateKey, timeZone),
      fetchGitHubProjects(targetDateKey),
    ]);

    const curatedNews = dedupeItems([...hackerNews, ...kr36News, ...googleNews]).slice(0, maxNewsItems);
    const curatedGithub = dedupeItems(githubRepos).slice(0, maxGithubItems);
    const allItems = dedupeItems([...curatedNews, ...curatedGithub]);

    if (allItems.length === 0) {
      console.warn(`[ai-news] No items fetched for ${targetDateKey}.`);
      return {
        targetDateKey,
        fetched: 0,
        created: 0,
        updated: 0,
        skipped: 0,
      };
    }

    const localizedItems = await localizeItemsToChinese(allItems);
    const stats = await persistItems(prisma, targetDateKey, localizedItems);

    return {
      targetDateKey,
      fetched: localizedItems.length,
      ...stats,
    };
  } finally {
    await prisma.$disconnect();
  }
}
