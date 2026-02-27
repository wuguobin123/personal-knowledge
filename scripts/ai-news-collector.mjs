import { PrismaClient } from "@prisma/client";

const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.AI_NEWS_FETCH_TIMEOUT_MS ?? "15000", 10);
const DEFAULT_MAX_NEWS_ITEMS = Number.parseInt(process.env.AI_NEWS_MAX_NEWS_ITEMS ?? "25", 10);
const DEFAULT_MAX_GITHUB_ITEMS = Number.parseInt(process.env.AI_NEWS_MAX_GITHUB_ITEMS ?? "20", 10);
const DEFAULT_TIMEZONE = process.env.AI_NEWS_TIMEZONE || "Asia/Shanghai";
const DEFAULT_USER_AGENT =
  process.env.AI_NEWS_USER_AGENT || "personal-knowledge-ai-news-bot/1.0";

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
  const controller = new AbortController();
  const timeoutMs = toPositiveInt(process.env.AI_NEWS_FETCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        ...(options.headers ?? {}),
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
  const queries = [
    { keyword: "new AI model", category: "MODEL_RELEASE" },
    { keyword: "open source AI", category: "GENERAL_NEWS" },
  ];

  const items = [];

  for (const query of queries) {
    const url =
      `https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=30&query=${encodeURIComponent(query.keyword)}`;

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
            author: hit?.author ?? null,
            createdAt: hit?.created_at ?? null,
          },
        });
      }
    } catch (error) {
      console.error(`[ai-news] Hacker News fetch failed for query "${query.keyword}":`, error.message);
    }
  }

  return items;
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
    const [googleNews, hackerNews, githubRepos] = await Promise.all([
      fetchGoogleNews(targetDateKey, timeZone),
      fetchHackerNews(targetDateKey, timeZone),
      fetchGitHubProjects(targetDateKey),
    ]);

    const curatedNews = dedupeItems([...googleNews, ...hackerNews]).slice(0, maxNewsItems);
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

    const stats = await persistItems(prisma, targetDateKey, allItems);

    return {
      targetDateKey,
      fetched: allItems.length,
      ...stats,
    };
  } finally {
    await prisma.$disconnect();
  }
}
