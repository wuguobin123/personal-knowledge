"use client";

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import MarkdownRenderer from "@/components/markdown-renderer";

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
};

type StreamDonePayload = StreamMetaPayload & {
  answer: string;
  thinking: string;
};

type ParsedAssistantContent = {
  finalAnswer: string;
  thinking: string;
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
  const feedRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<UiMessage[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<QaMode>("auto");

  const modeTitle = useMemo(() => {
    if (mode === "blog") return "Blog Context";
    if (mode === "web") return "Web Search";
    return "Auto";
  }, [mode]);

  useEffect(() => {
    const node = feedRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, loading]);

  const showPendingRow = useMemo(() => {
    if (!loading) return false;
    const latestAssistant = [...messages].reverse().find((item) => item.role === "assistant");
    return !latestAssistant || !latestAssistant.content.trim();
  }, [messages, loading]);

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

  return (
    <section className="admin-assistant-page">
      <header className="admin-assistant-topbar">
        <div className="admin-assistant-topic">
          <h2>Multi-Agent Q&A Assistant</h2>
          <span>Mode: {modeTitle}</span>
          <div className="admin-assistant-mode-switch">
            <button
              type="button"
              className={mode === "auto" ? "is-active" : undefined}
              onClick={() => setMode("auto")}
            >
              Auto
            </button>
            <button
              type="button"
              className={mode === "blog" ? "is-active" : undefined}
              onClick={() => setMode("blog")}
            >
              Blog Context
            </button>
            <button
              type="button"
              className={mode === "web" ? "is-active" : undefined}
              onClick={() => setMode("web")}
            >
              Web Search
            </button>
          </div>
        </div>
        <div className="admin-assistant-top-actions">
          <button
            type="button"
            onClick={() => {
              setMessages([INITIAL_MESSAGE]);
              setError("");
            }}
          >
            New Chat
          </button>
          <button
            type="button"
            aria-label="Clear input"
            onClick={() => {
              setInput("");
              setError("");
            }}
          >
            Clear
          </button>
        </div>
      </header>

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
              <button type="button" onClick={() => setMode("blog")} disabled={loading}>
                Blog
              </button>
              <button type="button" onClick={() => setMode("web")} disabled={loading}>
                Web
              </button>
              <button type="button" onClick={() => setMode("auto")} disabled={loading}>
                Auto
              </button>
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
