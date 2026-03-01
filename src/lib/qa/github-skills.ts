import { type QaSkillModeHint } from "@/lib/qa/skills-catalog";

const GITHUB_API_BASE = "https://api.github.com";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MIN_STARS = 500;
const DEFAULT_LIMIT = 8;

export type GithubSkillSearchItem = {
  fullName: string;
  owner: string;
  repo: string;
  description: string;
  stars: number;
  language: string | null;
  topics: string[];
  htmlUrl: string;
};

type GithubSearchResponse = {
  items?: Array<{
    full_name?: string;
    name?: string;
    owner?: { login?: string };
    description?: string | null;
    stargazers_count?: number;
    language?: string | null;
    topics?: string[];
    html_url?: string;
  }>;
};
type GithubSearchItemRaw = NonNullable<GithubSearchResponse["items"]>[number];

type GithubRepoResponse = {
  full_name?: string;
  name?: string;
  owner?: { login?: string };
  description?: string | null;
  stargazers_count?: number;
  language?: string | null;
  topics?: string[];
  html_url?: string;
  homepage?: string | null;
};

type GithubReadmeResponse = {
  content?: string;
  encoding?: string;
};

function getGithubHeaders(accept = "application/vnd.github+json") {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "personal-knowledge-admin",
  };

  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function githubGetJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: getGithubHeaders(),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`GitHub API request failed (${response.status}): ${message || "Unknown error"}`);
  }

  return (await response.json()) as T;
}

function normalizeSearchItem(item: GithubSearchItemRaw): GithubSkillSearchItem | null {
  const owner = item.owner?.login?.trim() || "";
  const repo = item.name?.trim() || "";
  const fullName = item.full_name?.trim() || (owner && repo ? `${owner}/${repo}` : "");
  if (!owner || !repo || !fullName) {
    return null;
  }

  return {
    fullName,
    owner,
    repo,
    description: String(item.description || "").trim(),
    stars: Number.isFinite(item.stargazers_count) ? Number(item.stargazers_count) : 0,
    language: item.language ?? null,
    topics: Array.isArray(item.topics)
      ? item.topics.map((topic) => String(topic).trim()).filter(Boolean).slice(0, 12)
      : [],
    htmlUrl: String(item.html_url || "").trim() || `https://github.com/${fullName}`,
  };
}

export async function searchGithubSkills(input: {
  query: string;
  minStars?: number;
  limit?: number;
}) {
  const query = input.query.trim();
  const minStars = Math.max(0, Math.floor(input.minStars ?? DEFAULT_MIN_STARS));
  const limit = Math.min(20, Math.max(1, Math.floor(input.limit ?? DEFAULT_LIMIT)));
  const keywords = query
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");
  const searchQuery = `${keywords} skill in:name,description,readme stars:>=${minStars}`;

  const url =
    `${GITHUB_API_BASE}/search/repositories?` +
    new URLSearchParams({
      q: searchQuery,
      sort: "stars",
      order: "desc",
      per_page: String(limit),
    }).toString();
  const payload = await githubGetJson<GithubSearchResponse>(url);

  return Array.isArray(payload.items)
    ? payload.items.map(normalizeSearchItem).filter((item): item is GithubSkillSearchItem => Boolean(item))
    : [];
}

async function fetchRepoReadme(owner: string, repo: string) {
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/readme`;
  const response = await fetch(url, {
    method: "GET",
    headers: getGithubHeaders(),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) {
    return "";
  }

  const payload = (await response.json()) as GithubReadmeResponse;
  if (!payload.content || payload.encoding !== "base64") {
    return "";
  }

  try {
    const decoded = Buffer.from(payload.content, "base64").toString("utf8");
    return decoded
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 2200);
  } catch {
    return "";
  }
}

export async function loadGithubRepoForSkill(owner: string, repo: string) {
  const safeOwner = owner.trim();
  const safeRepo = repo.trim();
  if (!safeOwner || !safeRepo) {
    throw new Error("Invalid owner/repo.");
  }

  const repoUrl = `${GITHUB_API_BASE}/repos/${encodeURIComponent(safeOwner)}/${encodeURIComponent(safeRepo)}`;
  const repoData = await githubGetJson<GithubRepoResponse>(repoUrl);
  const readmeSnippet = await fetchRepoReadme(safeOwner, safeRepo);

  const resolvedOwner = repoData.owner?.login?.trim() || safeOwner;
  const resolvedRepo = repoData.name?.trim() || safeRepo;
  const fullName = repoData.full_name?.trim() || `${resolvedOwner}/${resolvedRepo}`;
  const htmlUrl = repoData.html_url?.trim() || `https://github.com/${fullName}`;

  return {
    owner: resolvedOwner,
    repo: resolvedRepo,
    fullName,
    htmlUrl,
    description: String(repoData.description || "").trim(),
    stars: Number.isFinite(repoData.stargazers_count) ? Number(repoData.stargazers_count) : 0,
    language: repoData.language ?? null,
    topics: Array.isArray(repoData.topics)
      ? repoData.topics.map((topic) => String(topic).trim()).filter(Boolean).slice(0, 12)
      : [],
    homepage: repoData.homepage?.trim() || null,
    readmeSnippet,
  };
}

export function buildGithubSkillDraft(input: {
  fullName: string;
  description: string;
  htmlUrl: string;
  language: string | null;
  topics: string[];
  stars: number;
  readmeSnippet?: string;
  modeHint?: QaSkillModeHint;
}) {
  const topicText = input.topics.length > 0 ? input.topics.join(", ") : "无";
  const repoDescription = input.description || "未提供描述";
  const readme = input.readmeSnippet?.trim();
  const modeHint = input.modeHint || "auto";
  const instructionParts = [
    `你正在执行「${input.fullName}」技能辅助流程。`,
    "请优先按照以下规则回答：",
    "1) 先判断用户问题是否适合该技能主题；不适配时，先说明原因再给替代建议。",
    "2) 给出可执行步骤，尽量包含命令、配置项或清单。",
    "3) 如果仓库信息不足以直接下结论，必须明确标注假设，并提示用户二次确认。",
    "",
    "[GitHub 仓库信息]",
    `- Repo: ${input.fullName}`,
    `- URL: ${input.htmlUrl}`,
    `- Description: ${repoDescription}`,
    `- Stars: ${input.stars}`,
    `- Language: ${input.language || "unknown"}`,
    `- Topics: ${topicText}`,
  ];

  if (readme) {
    instructionParts.push("", "[README 摘要]", readme);
  }

  return {
    label: `${input.fullName} Skill`,
    description: repoDescription.slice(0, 220) || `${input.fullName} GitHub skill`,
    modeHint,
    instruction: instructionParts.join("\n"),
  };
}
