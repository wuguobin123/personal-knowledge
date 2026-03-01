"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import MarkdownRenderer from "@/components/markdown-renderer";
import {
  DEFAULT_QA_SKILL_ID,
  listQaSkills,
  type QaSkillId,
  type QaSkillModeHint,
  type QaSkillOption,
} from "@/lib/qa/skills-catalog";

type UiRole = "user" | "assistant";
type QaMode = "auto" | "blog" | "web";

type UiMessage = {
  id: string;
  role: UiRole;
  content: string;
  createdAt: number;
  meta?: StreamMetaPayload | null;
};

type QaReference = {
  id: number;
  title: string;
  slug: string;
  publishedAt: string;
};

type StreamMetaPayload = {
  route: "domain" | "general";
  reason: string;
  references: QaReference[];
  skillId?: QaSkillId;
  skillLabel?: string;
  skillDescription?: string;
  mcpUsed?: boolean;
  mcpModuleKey?: string;
  mcpModuleLabel?: string;
  mcpToolName?: string;
  mcpReason?: string;
  mcpError?: string;
};

type StreamDonePayload = StreamMetaPayload & {
  answer: string;
  thinking: string;
};

type ParsedAssistantContent = {
  finalAnswer: string;
  thinking: string;
};

type GithubSkillSearchItem = {
  fullName: string;
  owner: string;
  repo: string;
  description: string;
  stars: number;
  language: string | null;
  topics: string[];
  htmlUrl: string;
};

type QaMcpModule = {
  id: number;
  moduleKey: string;
  label: string;
  description: string;
  transport: "streamable_http";
  endpointUrl: string;
  keywordHints: string[];
  toolAllowlist: string[];
  headers: Record<string, string>;
  modeHint: QaSkillModeHint;
  isEnabled: boolean;
};

type QaSessionSummary = {
  id: number;
  title: string;
  status: "active" | "archived" | "deleted";
  mode: QaMode;
  skillId: QaSkillId;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
};

type QaPersistedMessage = {
  id: number;
  role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
  status: "COMPLETED" | "ERROR";
  content: string;
  reasoning: string | null;
  createdAt: string;
  meta?: unknown;
};

function createInitialMessage(): UiMessage {
  return {
    id: `assistant-initial-${Date.now()}`,
    role: "assistant",
    content:
      "你好，我是多 Agent 问答助手。你可以问我写作、SEO、博客内容优化，或一般技术问题。",
    createdAt: Date.now(),
  };
}

const SHORTCUTS = [
  "请根据我最近的文章风格，生成一段 120 字的开场引言。",
  "帮我检查下面这段内容的语法和可读性。",
  "基于我的博客内容，给出 5 个可写的新选题。",
];
const DEFAULT_QA_SKILLS: QaSkillOption[] = [...listQaSkills()];

function messageId(role: UiRole) {
  return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function timeLabel(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

function normalizeForApi(messages: UiMessage[]) {
  return messages.map((item) => ({ role: item.role, content: item.content }));
}

function formatReferences(references: QaReference[]) {
  if (!Array.isArray(references) || references.length === 0) {
    return "";
  }

  const lines = references.map((item) => `- [${item.title}](/blog/${item.slug})`);
  return `\n\n参考文章：\n${lines.join("\n")}`;
}

function buildAssistantContent(thinking: string, finalAnswer: string) {
  const normalizedThinking = thinking.trim();
  if (!normalizedThinking) {
    return finalAnswer;
  }
  return `<think>\n${normalizedThinking}\n</think>\n${finalAnswer}`;
}

function parseAssistantContent(content: string): ParsedAssistantContent {
  const raw = String(content || "");
  if (!raw) {
    return { finalAnswer: "", thinking: "" };
  }

  const openTag = "<think>";
  const closeTag = "</think>";
  const openIndex = raw.indexOf(openTag);
  const closeIndex = raw.indexOf(closeTag);

  if (openIndex >= 0 && closeIndex === -1) {
    return {
      finalAnswer: "",
      thinking: raw.slice(openIndex + openTag.length).trimStart(),
    };
  }

  if (closeIndex >= 0) {
    const thinkingRaw = raw
      .slice(0, closeIndex)
      .replace(/<think>/gi, "")
      .trim();
    const finalRaw = raw.slice(closeIndex + closeTag.length).trimStart();

    return {
      finalAnswer: finalRaw,
      thinking: thinkingRaw,
    };
  }

  const withoutThinkTags = raw.replace(/<\/?think>/gi, "");
  return {
    finalAnswer: withoutThinkTags || raw,
    thinking: "",
  };
}

function appendAssistantDelta(content: string, part: "thinking" | "answer", delta: string) {
  if (!delta) return content;

  const parsed = parseAssistantContent(content);
  const nextThinking = part === "thinking" ? `${parsed.thinking}${delta}` : parsed.thinking;
  const nextAnswer = part === "answer" ? `${parsed.finalAnswer}${delta}` : parsed.finalAnswer;
  return buildAssistantContent(nextThinking, nextAnswer);
}

function appendReferencesToContent(content: string, references: QaReference[]) {
  if (!Array.isArray(references) || references.length === 0) return content;

  const parsed = parseAssistantContent(content);
  if (parsed.finalAnswer.includes("参考文章：")) {
    return content;
  }

  return buildAssistantContent(parsed.thinking, `${parsed.finalAnswer}${formatReferences(references)}`);
}

type ParsedSseEvent = {
  event: string;
  data: string;
};

function parseSseEventBlock(rawBlock: string): ParsedSseEvent | null {
  const lines = rawBlock.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function parseApiError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as unknown;
  if (typeof data === "object" && data !== null && "error" in data && typeof data.error === "string") {
    return data.error;
  }
  return fallback;
}

function parseDelimitedList(raw: string) {
  return Array.from(
    new Set(
      String(raw || "")
        .split(/[,\n]/g)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function parseHeadersText(raw: string) {
  const text = String(raw || "").trim();
  if (!text) {
    return {} as Record<string, string>;
  }

  const parsed = parseJson<Record<string, unknown>>(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Headers 必须是 JSON 对象，例如 {\"Authorization\":\"Bearer xxx\"}");
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const headerKey = String(key || "").trim();
    if (!headerKey) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    const headerValue = String(value).trim();
    if (!headerValue) continue;
    headers[headerKey] = headerValue;
  }
  return headers;
}

function normalizeQaMode(mode: unknown): QaMode {
  if (mode === "blog" || mode === "web" || mode === "auto") {
    return mode;
  }
  return "auto";
}

function normalizeReferences(raw: unknown): QaReference[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const data = item as Record<string, unknown>;
      const id = Number(data.id);
      const title = typeof data.title === "string" ? data.title.trim() : "";
      const slug = typeof data.slug === "string" ? data.slug.trim() : "";
      const publishedAt = typeof data.publishedAt === "string" ? data.publishedAt : "";
      if (!Number.isInteger(id) || !title || !slug || !publishedAt) return null;
      return { id, title, slug, publishedAt } satisfies QaReference;
    })
    .filter((item): item is QaReference => Boolean(item));
}

function normalizeStreamMeta(raw: unknown): StreamMetaPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const route = data.route === "domain" ? "domain" : "general";
  const reason = typeof data.reason === "string" ? data.reason : "";
  const references = normalizeReferences(data.references);
  return {
    route,
    reason,
    references,
    ...(typeof data.skillId === "string" ? { skillId: data.skillId } : {}),
    ...(typeof data.skillLabel === "string" ? { skillLabel: data.skillLabel } : {}),
    ...(typeof data.skillDescription === "string"
      ? { skillDescription: data.skillDescription }
      : {}),
    ...(typeof data.mcpUsed === "boolean" ? { mcpUsed: data.mcpUsed } : {}),
    ...(typeof data.mcpModuleKey === "string" ? { mcpModuleKey: data.mcpModuleKey } : {}),
    ...(typeof data.mcpModuleLabel === "string" ? { mcpModuleLabel: data.mcpModuleLabel } : {}),
    ...(typeof data.mcpToolName === "string" ? { mcpToolName: data.mcpToolName } : {}),
    ...(typeof data.mcpReason === "string" ? { mcpReason: data.mcpReason } : {}),
    ...(typeof data.mcpError === "string" ? { mcpError: data.mcpError } : {}),
  };
}

function toUiMessageFromPersisted(item: QaPersistedMessage): UiMessage | null {
  const createdAt = Number(new Date(item.createdAt).getTime());
  const timestamp = Number.isFinite(createdAt) ? createdAt : Date.now();

  if (item.role === "USER") {
    return {
      id: `db-user-${item.id}`,
      role: "user",
      content: item.content,
      createdAt: timestamp,
    };
  }

  if (item.role !== "ASSISTANT") {
    return null;
  }

  const meta = normalizeStreamMeta(item.meta);
  const thinking = String(item.reasoning || "");
  const finalAnswer = String(item.content || "");
  const base = buildAssistantContent(thinking, finalAnswer);
  const content = appendReferencesToContent(base, meta?.references || []);

  return {
    id: `db-assistant-${item.id}`,
    role: "assistant",
    content,
    createdAt: timestamp,
    meta,
  };
}

function getMcpStatus(meta?: StreamMetaPayload | null) {
  if (!meta) return null;

  const hasSignal =
    typeof meta.mcpUsed === "boolean" ||
    Boolean(meta.mcpModuleLabel || meta.mcpModuleKey || meta.mcpToolName || meta.mcpError);
  if (!hasSignal) {
    return null;
  }

  const moduleLabel = meta.mcpModuleLabel || meta.mcpModuleKey || "未指定模块";
  const toolName = meta.mcpToolName || "未指定工具";
  const reason = meta.mcpReason?.trim() || "";
  const reasonLine = reason ? `路由原因：${reason}` : "";

  if (meta.mcpError?.trim()) {
    return {
      title: `MCP 调用失败：${moduleLabel} · ${toolName}`,
      detail: `${meta.mcpError}${reasonLine ? `\n${reasonLine}` : ""}`,
      isError: true,
    };
  }

  if (meta.mcpUsed) {
    return {
      title: `MCP 已调用：${moduleLabel} · ${toolName}`,
      detail: reasonLine,
      isError: false,
    };
  }

  return {
    title: "本次未调用 MCP 工具",
    detail: reasonLine,
    isError: false,
  };
}

function AssistantMessage({
  content,
  meta,
}: {
  content: string;
  meta?: StreamMetaPayload | null;
}) {
  const parsed = useMemo(() => parseAssistantContent(content), [content]);
  const mcpStatus = useMemo(() => getMcpStatus(meta), [meta]);
  const finalAnswer = parsed.finalAnswer.trim()
    ? parsed.finalAnswer
    : parsed.thinking
      ? "正在生成最终结果..."
      : "（暂无可展示内容）";

  return (
    <div className="admin-assistant-ai-content">
      <div className="admin-assistant-final">
        <span className="admin-assistant-final-label">最终结果</span>
        {mcpStatus ? (
          <div className={`admin-assistant-mcp-status${mcpStatus.isError ? " is-error" : ""}`}>
            <strong>{mcpStatus.title}</strong>
            {mcpStatus.detail ? <span>{mcpStatus.detail}</span> : null}
          </div>
        ) : null}
        <MarkdownRenderer content={finalAnswer} />
      </div>

      {parsed.thinking ? (
        <details className="admin-assistant-thinking" open={!parsed.finalAnswer.trim()}>
          <summary>思考过程</summary>
          <div className="admin-assistant-thinking-body">
            <MarkdownRenderer content={parsed.thinking} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

export default function QaAssistant() {
  const SKILL_PAGE_SIZE = 8;
  const feedRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<UiMessage[]>([createInitialMessage()]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [qaSessionId, setQaSessionId] = useState<number | null>(null);
  const [sessionHydrating, setSessionHydrating] = useState(false);
  const [sessionCreating, setSessionCreating] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [mode, setMode] = useState<QaMode>("auto");
  const [skills, setSkills] = useState<QaSkillOption[]>([...DEFAULT_QA_SKILLS]);
  const [selectedSkill, setSelectedSkill] = useState<QaSkillOption>(DEFAULT_QA_SKILLS[0]);
  const [skillId, setSkillId] = useState<QaSkillId>(DEFAULT_QA_SKILL_ID);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillError, setSkillError] = useState("");
  const [skillPage, setSkillPage] = useState(1);
  const [skillTotal, setSkillTotal] = useState(0);
  const [skillTotalPages, setSkillTotalPages] = useState(1);
  const [skillQueryInput, setSkillQueryInput] = useState("");
  const [skillQuery, setSkillQuery] = useState("");
  const [showSkillManager, setShowSkillManager] = useState(false);
  const [skillModalTab, setSkillModalTab] = useState<"select" | "manage">("select");
  const [skillManagerTab, setSkillManagerTab] = useState<"manual" | "github" | "mcp">("manual");
  const [manualLabel, setManualLabel] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualModeHint, setManualModeHint] = useState<QaSkillModeHint>("auto");
  const [manualInstruction, setManualInstruction] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualMessage, setManualMessage] = useState("");
  const [manualError, setManualError] = useState("");
  const [githubQuery, setGithubQuery] = useState("prompt engineering");
  const [githubMinStars, setGithubMinStars] = useState(500);
  const [githubResults, setGithubResults] = useState<GithubSkillSearchItem[]>([]);
  const [githubSearching, setGithubSearching] = useState(false);
  const [githubError, setGithubError] = useState("");
  const [githubMessage, setGithubMessage] = useState("");
  const [githubImporting, setGithubImporting] = useState("");
  const [mcpModules, setMcpModules] = useState<QaMcpModule[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpError, setMcpError] = useState("");
  const [mcpMessage, setMcpMessage] = useState("");
  const [mcpSubmitting, setMcpSubmitting] = useState(false);
  const [mcpLabel, setMcpLabel] = useState("");
  const [mcpDescription, setMcpDescription] = useState("");
  const [mcpEndpointUrl, setMcpEndpointUrl] = useState("");
  const [mcpModeHint, setMcpModeHint] = useState<QaSkillModeHint>("auto");
  const [mcpKeywordHints, setMcpKeywordHints] = useState("");
  const [mcpToolAllowlist, setMcpToolAllowlist] = useState("");
  const [mcpHeadersText, setMcpHeadersText] = useState("{}");
  const [mcpTesting, setMcpTesting] = useState(false);

  useEffect(() => {
    const node = feedRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    void loadSkills();
  }, []);

  useEffect(() => {
    void hydrateLatestSession();
  }, []);

  useEffect(() => {
    if (!showSkillManager) return;

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setShowSkillManager(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showSkillManager]);

  useEffect(() => {
    if (!showSkillManager || skillModalTab !== "manage" || skillManagerTab !== "mcp") {
      return;
    }
    void loadMcpModules();
  }, [showSkillManager, skillModalTab, skillManagerTab]);

  const showPendingRow = useMemo(() => {
    if (!loading) return false;
    const latestAssistant = [...messages].reverse().find((item) => item.role === "assistant");
    return !latestAssistant || !latestAssistant.content.trim();
  }, [messages, loading]);

  function applySelectedSkill(skill: QaSkillOption) {
    setSkillId(skill.id);
    setSelectedSkill(skill);
  }

  useEffect(() => {
    const matched = skills.find((item) => item.id === skillId);
    if (matched) {
      setSelectedSkill(matched);
    }
  }, [skills, skillId]);

  async function hydrateLatestSession() {
    setSessionHydrating(true);
    setSessionError("");

    try {
      const sessionResponse = await fetch("/api/admin/qa/sessions?limit=1", {
        method: "GET",
        cache: "no-store",
      });
      if (!sessionResponse.ok) {
        throw new Error(await parseApiError(sessionResponse, "Failed to load latest session."));
      }

      const sessionPayload = (await sessionResponse.json()) as { sessions?: QaSessionSummary[] };
      const latest = Array.isArray(sessionPayload.sessions) ? sessionPayload.sessions[0] : null;
      if (!latest || !Number.isInteger(latest.id) || latest.id <= 0) {
        setQaSessionId(null);
        setMessages([createInitialMessage()]);
        return;
      }

      setQaSessionId(latest.id);
      setMode(normalizeQaMode(latest.mode));
      if (typeof latest.skillId === "string" && latest.skillId.trim()) {
        setSkillId(latest.skillId);
      }

      const messageResponse = await fetch(
        `/api/admin/qa/sessions/messages?sessionId=${latest.id}&limit=300`,
        {
          method: "GET",
          cache: "no-store",
        },
      );
      if (!messageResponse.ok) {
        throw new Error(await parseApiError(messageResponse, "Failed to load session messages."));
      }

      const messagePayload = (await messageResponse.json()) as { messages?: QaPersistedMessage[] };
      const restored = (Array.isArray(messagePayload.messages) ? messagePayload.messages : [])
        .map(toUiMessageFromPersisted)
        .filter((item): item is UiMessage => Boolean(item));

      setMessages(restored.length > 0 ? restored : [createInitialMessage()]);
      setError("");
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "Failed to restore latest session.";
      setSessionError(message);
      setQaSessionId(null);
      setMessages([createInitialMessage()]);
    } finally {
      setSessionHydrating(false);
    }
  }

  async function createQaSession(options: {
    title?: string;
    resetMessages?: boolean;
    silent?: boolean;
  } = {}) {
    if (sessionCreating) {
      return qaSessionId;
    }

    const resetMessages = options.resetMessages ?? true;
    setSessionCreating(true);
    if (!options.silent) {
      setSessionError("");
    }

    try {
      const response = await fetch("/api/admin/qa/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: options.title,
          mode,
          skillId,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to create session."));
      }

      const payload = (await response.json()) as { session?: { id?: number } };
      const nextId = Number(payload.session?.id);
      if (!Number.isInteger(nextId) || nextId <= 0) {
        throw new Error("Session response is invalid.");
      }

      setQaSessionId(nextId);
      setSessionError("");
      if (resetMessages) {
        setMessages([createInitialMessage()]);
        setError("");
      }
      return nextId;
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Failed to create session.";
      setSessionError(message);
      return null;
    } finally {
      setSessionCreating(false);
    }
  }

  async function loadSkills(
    options: {
      page?: number;
      query?: string;
      preferredSkill?: QaSkillOption | null;
    } = {},
  ) {
    const nextPage = options.page ?? skillPage;
    const nextQuery = options.query ?? skillQuery;

    setSkillsLoading(true);
    setSkillError("");

    try {
      const params = new URLSearchParams({
        page: String(Math.max(1, nextPage)),
        pageSize: String(SKILL_PAGE_SIZE),
        q: nextQuery,
      });
      const response = await fetch(`/api/admin/qa/skills?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to load skills."));
      }

      const payload = (await response.json()) as {
        skills?: QaSkillOption[];
        total?: number;
        totalPages?: number;
        page?: number;
      };
      const nextSkills = Array.isArray(payload.skills) ? payload.skills : [...DEFAULT_QA_SKILLS];
      setSkills(nextSkills);
      setSkillTotal(Number.isFinite(payload.total) ? Number(payload.total) : nextSkills.length);
      setSkillTotalPages(Number.isFinite(payload.totalPages) ? Math.max(1, Number(payload.totalPages)) : 1);
      setSkillPage(Number.isFinite(payload.page) ? Math.max(1, Number(payload.page)) : nextPage);
      setSkillQuery(nextQuery);

      if (options.preferredSkill) {
        applySelectedSkill(options.preferredSkill);
      } else {
        const matched = nextSkills.find((item) => item.id === skillId);
        if (matched) {
          setSelectedSkill(matched);
        }
      }
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : "Failed to load skills.";
      setSkillError(message);
      setSkills([...DEFAULT_QA_SKILLS]);
      setSkillTotal(DEFAULT_QA_SKILLS.length);
      setSkillTotalPages(1);
      setSkillPage(1);
    } finally {
      setSkillsLoading(false);
    }
  }

  async function createManualSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (manualSubmitting) return;

    setManualSubmitting(true);
    setManualError("");
    setManualMessage("");

    try {
      const response = await fetch("/api/admin/qa/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: manualLabel,
          description: manualDescription,
          modeHint: manualModeHint,
          instruction: manualInstruction,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to create skill."));
      }

      const payload = (await response.json()) as { skill?: QaSkillOption };
      const createdSkill = payload.skill || null;
      await loadSkills({
        page: 1,
        query: "",
        preferredSkill: createdSkill,
      });
      setSkillQueryInput("");
      setManualMessage("自定义 Skill 已创建并加入列表。");
      setManualLabel("");
      setManualDescription("");
      setManualInstruction("");
      setShowSkillManager(false);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Failed to create skill.";
      setManualError(message);
    } finally {
      setManualSubmitting(false);
    }
  }

  async function searchGithubSkillItems(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (githubSearching) return;

    setGithubSearching(true);
    setGithubError("");
    setGithubMessage("");

    try {
      const params = new URLSearchParams({
        q: githubQuery.trim(),
        minStars: String(Math.max(0, Math.floor(githubMinStars || 0))),
        limit: "8",
      });
      const response = await fetch(`/api/admin/qa/skills/github-search?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to search GitHub skills."));
      }

      const payload = (await response.json()) as { items?: GithubSkillSearchItem[] };
      setGithubResults(Array.isArray(payload.items) ? payload.items : []);
      if (!payload.items || payload.items.length === 0) {
        setGithubMessage("没有命中结果，可以换关键词或降低 stars 门槛。");
      }
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Failed to search GitHub skills.";
      setGithubError(message);
      setGithubResults([]);
    } finally {
      setGithubSearching(false);
    }
  }

  async function importGithubSkill(item: GithubSkillSearchItem) {
    if (githubImporting) return;
    setGithubImporting(item.fullName);
    setGithubError("");
    setGithubMessage("");

    try {
      const response = await fetch("/api/admin/qa/skills/github-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: item.owner,
          repo: item.repo,
          modeHint: "auto",
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to import GitHub skill."));
      }

      const payload = (await response.json()) as { created?: boolean; skill?: QaSkillOption };
      const importedSkill = payload.skill || null;
      await loadSkills({
        page: 1,
        query: "",
        preferredSkill: importedSkill,
      });
      setSkillQueryInput("");
      setGithubMessage(payload.created ? `已导入 ${item.fullName}` : `${item.fullName} 已存在，已切换到该 Skill`);
      setShowSkillManager(false);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Failed to import GitHub skill.";
      setGithubError(message);
    } finally {
      setGithubImporting("");
    }
  }

  async function loadMcpModules() {
    setMcpLoading(true);
    setMcpError("");

    try {
      const response = await fetch("/api/admin/qa/mcp-modules", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to load MCP modules."));
      }

      const payload = (await response.json()) as { modules?: QaMcpModule[] };
      setMcpModules(Array.isArray(payload.modules) ? payload.modules : []);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Failed to load MCP modules.";
      setMcpError(message);
      setMcpModules([]);
    } finally {
      setMcpLoading(false);
    }
  }

  async function createMcpModule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mcpSubmitting) return;

    setMcpSubmitting(true);
    setMcpError("");
    setMcpMessage("");

    try {
      const headers = parseHeadersText(mcpHeadersText);
      const keywordHints = parseDelimitedList(mcpKeywordHints).slice(0, 20);
      const toolAllowlist = parseDelimitedList(mcpToolAllowlist).slice(0, 60);

      const response = await fetch("/api/admin/qa/mcp-modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: mcpLabel,
          description: mcpDescription,
          endpointUrl: mcpEndpointUrl,
          modeHint: mcpModeHint,
          headers,
          keywordHints,
          toolAllowlist,
        }),
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to create MCP module."));
      }

      await loadMcpModules();
      setMcpLabel("");
      setMcpDescription("");
      setMcpEndpointUrl("");
      setMcpModeHint("auto");
      setMcpKeywordHints("");
      setMcpToolAllowlist("");
      setMcpHeadersText("{}");
      setMcpMessage("MCP 模块已创建，问答时会自动评估是否调用其工具。");
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Failed to create MCP module.";
      setMcpError(message);
    } finally {
      setMcpSubmitting(false);
    }
  }

  async function testMcpConnection() {
    if (mcpSubmitting || mcpTesting) return;

    setMcpTesting(true);
    setMcpError("");
    setMcpMessage("");

    try {
      const endpointUrl = mcpEndpointUrl.trim();
      if (!endpointUrl) {
        throw new Error("请先填写 MCP Endpoint URL。");
      }

      const headers = parseHeadersText(mcpHeadersText);
      const response = await fetch("/api/admin/qa/mcp-modules/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpointUrl,
          headers,
        }),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response, "MCP 连接测试失败。"));
      }

      const payload = (await response.json()) as {
        message?: string;
        serverInfo?: {
          name?: string;
          version?: string;
        };
        toolCount?: number;
        sampleTools?: string[];
      };
      const serverName = payload.serverInfo?.name?.trim() || "未知服务";
      const serverVersion = payload.serverInfo?.version?.trim();
      const serverLabel = serverVersion ? `${serverName} v${serverVersion}` : serverName;
      const toolCount = Number.isFinite(payload.toolCount) ? Number(payload.toolCount) : null;
      const sampleTools = Array.isArray(payload.sampleTools) ? payload.sampleTools.filter(Boolean) : [];
      const toolsLabel =
        toolCount === null
          ? ""
          : sampleTools.length > 0
            ? `，工具数 ${toolCount}（${sampleTools.join(", ")}）`
            : `，工具数 ${toolCount}`;

      setMcpMessage(payload.message?.trim() || `连接成功：${serverLabel}${toolsLabel}`);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "MCP 连接测试失败。";
      setMcpError(message);
    } finally {
      setMcpTesting(false);
    }
  }

  async function sendMessage(rawText: string) {
    const content = rawText.trim();
    if (!content || loading || sessionCreating || sessionHydrating) return;

    let activeSessionId = qaSessionId;
    if (!activeSessionId) {
      activeSessionId = await createQaSession({
        title: content.slice(0, 80),
        resetMessages: false,
      });
      if (!activeSessionId) {
        setError("会话创建失败，请稍后重试。");
        return;
      }
    }

    const userMessage: UiMessage = {
      id: messageId("user"),
      role: "user",
      content,
      createdAt: Date.now(),
    };
    const assistantId = messageId("assistant");
    const requestMessages = [...messages, userMessage];
    const assistantMessage: UiMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      meta: null,
    };
    const nextMessages = [...requestMessages, assistantMessage];
    setMessages(nextMessages);
    setInput("");
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/admin/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeSessionId,
          mode,
          skillId,
          messages: normalizeForApi(requestMessages),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as unknown;
        const message =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "AI request failed.";
        throw new Error(message);
      }

      if (!response.body) {
        throw new Error("AI stream is unavailable.");
      }

      const sessionIdFromHeader = Number(response.headers.get("x-qa-session-id") || "");
      if (Number.isInteger(sessionIdFromHeader) && sessionIdFromHeader > 0) {
        setQaSessionId(sessionIdFromHeader);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let latestMeta: StreamMetaPayload | null = null;
      let hasDone = false;

      const updateAssistantMessage = (updater: (prevContent: string) => string) => {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: updater(message.content),
                }
              : message,
          ),
        );
      };
      const updateAssistantMeta = (meta: StreamMetaPayload | null) => {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  meta,
                }
              : message,
          ),
        );
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");

        while (true) {
          const boundary = buffer.indexOf("\n\n");
          if (boundary === -1) break;

          const rawBlock = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 2);
          if (!rawBlock) continue;

          const parsedEvent = parseSseEventBlock(rawBlock);
          if (!parsedEvent) continue;

          if (parsedEvent.event === "meta") {
            const meta = parseJson<StreamMetaPayload>(parsedEvent.data);
            if (meta) {
              latestMeta = meta;
              updateAssistantMeta(meta);
            }
            continue;
          }

          if (parsedEvent.event === "thinking_delta") {
            const payload = parseJson<{ text?: string }>(parsedEvent.data);
            const text = typeof payload?.text === "string" ? payload.text : "";
            if (text) {
              updateAssistantMessage((prevContent) =>
                appendAssistantDelta(prevContent, "thinking", text),
              );
            }
            continue;
          }

          if (parsedEvent.event === "answer_delta") {
            const payload = parseJson<{ text?: string }>(parsedEvent.data);
            const text = typeof payload?.text === "string" ? payload.text : "";
            if (text) {
              updateAssistantMessage((prevContent) =>
                appendAssistantDelta(prevContent, "answer", text),
              );
            }
            continue;
          }

          if (parsedEvent.event === "done") {
            const donePayload = parseJson<StreamDonePayload>(parsedEvent.data);
            if (donePayload) {
              latestMeta = donePayload;
              hasDone = true;
              updateAssistantMeta(donePayload);
              const finalWithReferences = `${donePayload.answer}${formatReferences(
                donePayload.references,
              )}`;
              updateAssistantMessage(() =>
                buildAssistantContent(donePayload.thinking, finalWithReferences),
              );
            }
            continue;
          }

          if (parsedEvent.event === "error") {
            const payload = parseJson<{ message?: string }>(parsedEvent.data);
            const message =
              typeof payload?.message === "string" && payload.message.trim()
                ? payload.message
                : "AI stream failed.";
            throw new Error(message);
          }
        }
      }

      if (!hasDone && latestMeta) {
        updateAssistantMeta(latestMeta);
        updateAssistantMessage((prevContent) =>
          appendReferencesToContent(prevContent, latestMeta?.references || []),
        );
      }
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "AI request failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  function openSkillModal(tab: "select" | "manage") {
    setSkillModalTab(tab);
    setShowSkillManager(true);
    if (tab === "select") {
      void loadSkills({ page: skillPage, query: skillQuery });
    }
  }

  function handleSkillSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = skillQueryInput.trim();
    void loadSkills({
      page: 1,
      query: nextQuery,
    });
  }

  function goToSkillPage(nextPage: number) {
    void loadSkills({
      page: Math.max(1, nextPage),
      query: skillQuery,
    });
  }

  return (
    <section className="admin-assistant-page">
      <header className="admin-assistant-topbar">
        <div className="admin-assistant-topic">
          <h2>Multi-Agent Q&A Assistant</h2>
          <span />
          <p className="admin-assistant-skill-desc">{selectedSkill.description}</p>
          <p className="admin-assistant-skill-desc">
            {sessionHydrating
              ? "会话恢复中..."
              : qaSessionId
                ? `当前会话 ID: ${qaSessionId}`
                : "当前还未创建会话"}
          </p>
        </div>
        <div className="admin-assistant-top-actions">
          <button
            type="button"
            onClick={() => {
              void createQaSession();
            }}
            disabled={loading || sessionCreating || sessionHydrating}
          >
            {sessionCreating ? "创建中..." : "新建会话"}
          </button>
          <button type="button" onClick={() => openSkillModal("select")} disabled={loading}>
            选择 Skill
          </button>
          <button
            type="button"
            onClick={() => openSkillModal("manage")}
            disabled={loading}
          >
            添加 Skill
          </button>
        </div>
      </header>
      {sessionError ? <p className="admin-assistant-skill-error">会话错误：{sessionError}</p> : null}
      {skillError ? <p className="admin-assistant-skill-error">Skill 加载失败：{skillError}</p> : null}

      {showSkillManager ? (
        <div className="admin-skill-modal" onClick={() => setShowSkillManager(false)}>
          <section className="admin-skill-modal-panel" onClick={(event) => event.stopPropagation()}>
            <header className="admin-skill-modal-head">
              <h3>Skill 配置中心</h3>
              <button type="button" onClick={() => setShowSkillManager(false)} aria-label="关闭弹窗">
                ×
              </button>
            </header>

            <div className="admin-skill-modal-tabs">
              <button
                type="button"
                className={skillModalTab === "select" ? "is-active" : undefined}
                onClick={() => setSkillModalTab("select")}
                disabled={
                  manualSubmitting || githubSearching || Boolean(githubImporting) || mcpSubmitting
                }
              >
                选择 Skill
              </button>
              <button
                type="button"
                className={skillModalTab === "manage" ? "is-active" : undefined}
                onClick={() => setSkillModalTab("manage")}
                disabled={
                  manualSubmitting || githubSearching || Boolean(githubImporting) || mcpSubmitting
                }
              >
                添加 Skill
              </button>
            </div>

            {skillModalTab === "select" ? (
              <section className="admin-skill-selector">
                <form className="admin-skill-selector-search" onSubmit={handleSkillSearch}>
                  <input
                    type="text"
                    value={skillQueryInput}
                    onChange={(event) => setSkillQueryInput(event.target.value)}
                    placeholder="按名称或描述搜索 Skill"
                    maxLength={80}
                  />
                  <button type="submit" disabled={skillsLoading}>
                    查询
                  </button>
                </form>

                <div className="admin-skill-card-list">
                  {skills.length > 0 ? (
                    skills.map((skill) => {
                      const isSelected = skill.id === skillId;
                      return (
                        <article
                          key={skill.id}
                          className={`admin-skill-card${isSelected ? " is-selected" : ""}`}
                        >
                          <header>
                            <h4>{skill.label}</h4>
                            <span>{skill.source}</span>
                          </header>
                          <p>{skill.description}</p>
                          {skill.stars ? (
                            <small>⭐ {skill.stars.toLocaleString()}</small>
                          ) : (
                            <small>自定义 Skill</small>
                          )}
                          <div className="admin-skill-card-actions">
                            {skill.githubUrl ? (
                              <a href={skill.githubUrl} target="_blank" rel="noreferrer">
                                GitHub
                              </a>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => applySelectedSkill(skill)}
                              disabled={isSelected}
                            >
                              {isSelected ? "已选中" : "使用"}
                            </button>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <p className="admin-skill-empty">暂无匹配 Skill</p>
                  )}
                </div>

                <div className="admin-skill-pagination">
                  <button
                    type="button"
                    onClick={() => goToSkillPage(skillPage - 1)}
                    disabled={skillsLoading || skillPage <= 1}
                  >
                    上一页
                  </button>
                  <span>
                    第 {skillPage} / {skillTotalPages} 页 · 共 {skillTotal} 条
                  </span>
                  <button
                    type="button"
                    onClick={() => goToSkillPage(skillPage + 1)}
                    disabled={skillsLoading || skillPage >= skillTotalPages}
                  >
                    下一页
                  </button>
                </div>

                <div className="admin-skill-manager-actions">
                  <button
                    type="button"
                    onClick={() => void loadSkills({ page: skillPage, query: skillQuery })}
                    disabled={loading || skillsLoading}
                  >
                    {skillsLoading ? "刷新中..." : "刷新"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSkillManager(false)}
                    disabled={loading || skillsLoading}
                  >
                    完成
                  </button>
                </div>
              </section>
            ) : (
              <section className="admin-skill-manager">
                <div className="admin-skill-manager-tabs">
                  <button
                    type="button"
                    className={skillManagerTab === "manual" ? "is-active" : undefined}
                    onClick={() => setSkillManagerTab("manual")}
                    disabled={
                      manualSubmitting || githubSearching || Boolean(githubImporting) || mcpSubmitting
                    }
                  >
                    手动创建
                  </button>
                  <button
                    type="button"
                    className={skillManagerTab === "github" ? "is-active" : undefined}
                    onClick={() => setSkillManagerTab("github")}
                    disabled={
                      manualSubmitting || githubSearching || Boolean(githubImporting) || mcpSubmitting
                    }
                  >
                    GitHub 高 Star
                  </button>
                  <button
                    type="button"
                    className={skillManagerTab === "mcp" ? "is-active" : undefined}
                    onClick={() => setSkillManagerTab("mcp")}
                    disabled={
                      manualSubmitting || githubSearching || Boolean(githubImporting) || mcpSubmitting
                    }
                  >
                    MCP 模块
                  </button>
                </div>

                {skillManagerTab === "manual" ? (
                  <form className="admin-skill-manager-form" onSubmit={createManualSkill}>
                    <label>
                      名称
                      <input
                        type="text"
                        value={manualLabel}
                        onChange={(event) => setManualLabel(event.target.value)}
                        placeholder="例如：客户邮件回复优化"
                        maxLength={120}
                        required
                      />
                    </label>
                    <label>
                      描述
                      <input
                        type="text"
                        value={manualDescription}
                        onChange={(event) => setManualDescription(event.target.value)}
                        placeholder="这个 Skill 的用途"
                        maxLength={400}
                      />
                    </label>
                    <label>
                      Mode 偏好
                      <select
                        value={manualModeHint}
                        onChange={(event) => setManualModeHint(event.target.value as QaSkillModeHint)}
                      >
                        <option value="auto">Auto</option>
                        <option value="blog">Blog</option>
                        <option value="web">Web</option>
                      </select>
                    </label>
                    <label>
                      指令模板
                      <textarea
                        value={manualInstruction}
                        onChange={(event) => setManualInstruction(event.target.value)}
                        placeholder="写清楚执行流程、输出格式、约束条件..."
                        rows={6}
                        minLength={12}
                        maxLength={12000}
                        required
                      />
                    </label>

                    <div className="admin-skill-manager-actions">
                      <button type="submit" disabled={manualSubmitting}>
                        {manualSubmitting ? "创建中..." : "创建 Skill"}
                      </button>
                      {manualMessage ? <span>{manualMessage}</span> : null}
                      {manualError ? <span className="is-error">{manualError}</span> : null}
                    </div>
                  </form>
                ) : skillManagerTab === "github" ? (
                  <section className="admin-skill-manager-github">
                    <form className="admin-skill-manager-form is-inline" onSubmit={searchGithubSkillItems}>
                      <label>
                        关键词
                        <input
                          type="text"
                          value={githubQuery}
                          onChange={(event) => setGithubQuery(event.target.value)}
                          placeholder="例如：prompt engineering"
                          maxLength={80}
                          required
                        />
                      </label>
                      <label>
                        最低 Stars
                        <input
                          type="number"
                          value={githubMinStars}
                          onChange={(event) => setGithubMinStars(Number(event.target.value) || 0)}
                          min={0}
                          max={1000000}
                        />
                      </label>
                      <div className="admin-skill-manager-actions">
                        <button type="submit" disabled={githubSearching}>
                          {githubSearching ? "搜索中..." : "搜索 GitHub"}
                        </button>
                      </div>
                    </form>

                    {githubMessage ? <p className="admin-skill-manager-hint">{githubMessage}</p> : null}
                    {githubError ? <p className="admin-skill-manager-hint is-error">{githubError}</p> : null}

                    <div className="admin-skill-manager-results">
                      {githubResults.map((item) => (
                        <article key={item.fullName}>
                          <div>
                            <h4>{item.fullName}</h4>
                            <p>{item.description || "No description"}</p>
                            <small>
                              ⭐ {item.stars.toLocaleString()} · {item.language || "unknown"}
                            </small>
                          </div>
                          <div className="admin-skill-manager-actions">
                            <a href={item.htmlUrl} target="_blank" rel="noreferrer">
                              打开仓库
                            </a>
                            <button
                              type="button"
                              onClick={() => void importGithubSkill(item)}
                              disabled={Boolean(githubImporting)}
                            >
                              {githubImporting === item.fullName ? "导入中..." : "导入为 Skill"}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : (
                  <section className="admin-skill-manager-github">
                    <form className="admin-skill-manager-form" onSubmit={createMcpModule}>
                      <label>
                        模块名称
                        <input
                          type="text"
                          value={mcpLabel}
                          onChange={(event) => setMcpLabel(event.target.value)}
                          placeholder="例如：GitHub MCP"
                          maxLength={120}
                          required
                        />
                      </label>
                      <label>
                        描述
                        <input
                          type="text"
                          value={mcpDescription}
                          onChange={(event) => setMcpDescription(event.target.value)}
                          placeholder="这个 MCP 模块能做什么"
                          maxLength={400}
                        />
                      </label>
                      <label>
                        MCP Endpoint URL
                        <input
                          type="url"
                          value={mcpEndpointUrl}
                          onChange={(event) => setMcpEndpointUrl(event.target.value)}
                          placeholder="https://your-mcp-server.example.com/mcp"
                          maxLength={500}
                          required
                        />
                      </label>
                      <label>
                        Mode 偏好
                        <select
                          value={mcpModeHint}
                          onChange={(event) => setMcpModeHint(event.target.value as QaSkillModeHint)}
                        >
                          <option value="auto">Auto</option>
                          <option value="blog">Blog</option>
                          <option value="web">Web</option>
                        </select>
                      </label>
                      <label>
                        关键词提示（逗号分隔，可选）
                        <input
                          type="text"
                          value={mcpKeywordHints}
                          onChange={(event) => setMcpKeywordHints(event.target.value)}
                          placeholder="github, issue, pr, repo"
                          maxLength={1200}
                        />
                      </label>
                      <label>
                        工具白名单（逗号分隔，可选）
                        <input
                          type="text"
                          value={mcpToolAllowlist}
                          onChange={(event) => setMcpToolAllowlist(event.target.value)}
                          placeholder="search_repositories, create_issue"
                          maxLength={2000}
                        />
                      </label>
                      <label>
                        Headers（JSON，对象格式）
                        <textarea
                          value={mcpHeadersText}
                          onChange={(event) => setMcpHeadersText(event.target.value)}
                          rows={4}
                          placeholder='{"Authorization":"Bearer xxx"}'
                          maxLength={4000}
                        />
                      </label>

                      <div className="admin-skill-manager-actions">
                        <button type="submit" disabled={mcpSubmitting || mcpTesting}>
                          {mcpSubmitting ? "创建中..." : "创建 MCP 模块"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void testMcpConnection()}
                          disabled={mcpSubmitting || mcpTesting}
                        >
                          {mcpTesting ? "测试中..." : "连接测试"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void loadMcpModules()}
                          disabled={mcpLoading || mcpSubmitting || mcpTesting}
                        >
                          {mcpLoading ? "刷新中..." : "刷新列表"}
                        </button>
                        {mcpMessage ? <span>{mcpMessage}</span> : null}
                        {mcpError ? <span className="is-error">{mcpError}</span> : null}
                      </div>
                    </form>

                    <div className="admin-skill-manager-results">
                      {mcpModules.length === 0 ? (
                        <p className="admin-skill-manager-hint">暂无 MCP 模块，可先创建一个。</p>
                      ) : (
                        mcpModules.map((item) => (
                          <article key={item.moduleKey}>
                            <div>
                              <h4>{item.label}</h4>
                              <p>{item.description}</p>
                              <small>
                                {item.endpointUrl} · {item.isEnabled ? "enabled" : "disabled"} · mode:{" "}
                                {item.modeHint}
                              </small>
                            </div>
                            <div className="admin-skill-manager-actions">
                              <small>tools: {item.toolAllowlist.length || "all"}</small>
                              <small>keywords: {item.keywordHints.join(", ") || "none"}</small>
                            </div>
                          </article>
                        ))
                      )}
                    </div>
                  </section>
                )}
              </section>
            )}
          </section>
        </div>
      ) : null}

      <div className="admin-assistant-feed" ref={feedRef}>
        {messages.map((message) =>
          message.role === "assistant" ? (
            <article className="admin-assistant-row" key={message.id}>
              <div className="admin-assistant-avatar is-ai">AI</div>
              <div className="admin-assistant-bubble is-ai">
                <AssistantMessage content={message.content} meta={message.meta} />
              </div>
            </article>
          ) : (
            <article className="admin-assistant-row is-user" key={message.id}>
              <div className="admin-assistant-avatar is-user">U</div>
              <div className="admin-assistant-message">
                <div className="admin-assistant-bubble is-user">{message.content}</div>
                <p>Sent {timeLabel(message.createdAt)}</p>
              </div>
            </article>
          ),
        )}

        {showPendingRow ? (
          <article className="admin-assistant-row">
            <div className="admin-assistant-avatar is-ai">AI</div>
            <div className="admin-assistant-bubble is-ai">
              <p>正在连接模型...</p>
            </div>
          </article>
        ) : null}

        {error ? (
          <article className="admin-assistant-row">
            <div className="admin-assistant-avatar is-ai">AI</div>
            <div className="admin-assistant-bubble is-ai">
              <p>请求失败：{error}</p>
            </div>
          </article>
        ) : null}
      </div>

      <footer className="admin-assistant-compose">
        <div className="admin-assistant-compose-box">
          <textarea
            rows={3}
            placeholder="输入你的问题..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading || sessionCreating || sessionHydrating}
          />
          <div className="admin-assistant-compose-row">
            <div className="admin-assistant-compose-tools">
              <button
                type="button"
                className={mode === "blog" ? "is-active" : undefined}
                onClick={() => setMode("blog")}
                disabled={loading || sessionCreating || sessionHydrating}
              >
                Blog
              </button>
              <button
                type="button"
                className={mode === "web" ? "is-active" : undefined}
                onClick={() => setMode("web")}
                disabled={loading || sessionCreating || sessionHydrating}
              >
                Web
              </button>
              <button
                type="button"
                className={mode === "auto" ? "is-active" : undefined}
                onClick={() => setMode("auto")}
                disabled={loading || sessionCreating || sessionHydrating}
              >
                Auto
              </button>
              <span className="admin-assistant-skill-tag">
                Skill: {selectedSkill.label}
                {selectedSkill.source !== "builtin" ? ` (${selectedSkill.source})` : ""}
              </span>
            </div>
            <div className="admin-assistant-compose-send">
              <span>Enter 发送 / Shift + Enter 换行</span>
              <button
                type="button"
                onClick={() => void sendMessage(input)}
                disabled={loading || sessionCreating || sessionHydrating}
              >
                {loading ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
        <div className="admin-assistant-shortcuts">
          {SHORTCUTS.map((shortcut) => (
            <button
              key={shortcut}
              type="button"
              onClick={() => void sendMessage(shortcut)}
              disabled={loading || sessionCreating || sessionHydrating}
            >
              {shortcut}
            </button>
          ))}
        </div>
      </footer>
    </section>
  );
}
