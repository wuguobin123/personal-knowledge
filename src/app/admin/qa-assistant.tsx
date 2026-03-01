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

const INITIAL_MESSAGE: UiMessage = {
  id: "assistant-initial",
  role: "assistant",
  content:
    "你好，我是多 Agent 问答助手。你可以问我写作、SEO、博客内容优化，或一般技术问题。",
  createdAt: Date.now(),
};

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

function AssistantMessage({ content }: { content: string }) {
  const parsed = useMemo(() => parseAssistantContent(content), [content]);
  const finalAnswer = parsed.finalAnswer.trim()
    ? parsed.finalAnswer
    : parsed.thinking
      ? "正在生成最终结果..."
      : "（暂无可展示内容）";

  return (
    <div className="admin-assistant-ai-content">
      <div className="admin-assistant-final">
        <span className="admin-assistant-final-label">最终结果</span>
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
  const [messages, setMessages] = useState<UiMessage[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
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
  const [skillManagerTab, setSkillManagerTab] = useState<"manual" | "github">("manual");
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

  useEffect(() => {
    const node = feedRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, loading]);

  useEffect(() => {
    void loadSkills();
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

  const showPendingRow = useMemo(() => {
    if (!loading) return false;
    const latestAssistant = [...messages].reverse().find((item) => item.role === "assistant");
    return !latestAssistant || !latestAssistant.content.trim();
  }, [messages, loading]);

  function applySelectedSkill(skill: QaSkillOption) {
    setSkillId(skill.id);
    setSelectedSkill(skill);
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

  async function sendMessage(rawText: string) {
    const content = rawText.trim();
    if (!content || loading) return;

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
            if (meta) latestMeta = meta;
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
        </div>
        <div className="admin-assistant-top-actions">
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
                disabled={manualSubmitting || githubSearching || Boolean(githubImporting)}
              >
                选择 Skill
              </button>
              <button
                type="button"
                className={skillModalTab === "manage" ? "is-active" : undefined}
                onClick={() => setSkillModalTab("manage")}
                disabled={manualSubmitting || githubSearching || Boolean(githubImporting)}
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
                    disabled={manualSubmitting || githubSearching || Boolean(githubImporting)}
                  >
                    手动创建
                  </button>
                  <button
                    type="button"
                    className={skillManagerTab === "github" ? "is-active" : undefined}
                    onClick={() => setSkillManagerTab("github")}
                    disabled={manualSubmitting || githubSearching || Boolean(githubImporting)}
                  >
                    GitHub 高 Star
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
                ) : (
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
                <AssistantMessage content={message.content} />
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
            disabled={loading}
          />
          <div className="admin-assistant-compose-row">
            <div className="admin-assistant-compose-tools">
              <button
                type="button"
                className={mode === "blog" ? "is-active" : undefined}
                onClick={() => setMode("blog")}
                disabled={loading}
              >
                Blog
              </button>
              <button
                type="button"
                className={mode === "web" ? "is-active" : undefined}
                onClick={() => setMode("web")}
                disabled={loading}
              >
                Web
              </button>
              <button
                type="button"
                className={mode === "auto" ? "is-active" : undefined}
                onClick={() => setMode("auto")}
                disabled={loading}
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
              <button type="button" onClick={() => void sendMessage(input)} disabled={loading}>
                {loading ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
        <div className="admin-assistant-shortcuts">
          {SHORTCUTS.map((shortcut) => (
            <button key={shortcut} type="button" onClick={() => void sendMessage(shortcut)} disabled={loading}>
              {shortcut}
            </button>
          ))}
        </div>
      </footer>
    </section>
  );
}
