import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { prisma } from "@/lib/prisma";

export type QaRole = "user" | "assistant";
export type QaMode = "auto" | "blog" | "web";

export type QaMessage = {
  role: QaRole;
  content: string;
};

type PlannerRoute = "domain" | "general";

type PlannerDecision = {
  route: PlannerRoute;
  reason: string;
};

type ArticleForContext = {
  id: number;
  title: string;
  slug: string;
  category: string;
  excerpt: string;
  content: string;
  tags: unknown;
  publishedAt: Date;
};

export type QaReference = {
  id: number;
  title: string;
  slug: string;
  publishedAt: string;
};

export type QaMultiAgentResult = {
  answer: string;
  route: PlannerRoute;
  reason: string;
  references: QaReference[];
};

export type QaStreamMeta = {
  route: PlannerRoute;
  reason: string;
  references: QaReference[];
};

export type QaMultiAgentStreamResult = QaStreamMeta & {
  answer: string;
  thinking: string;
};

type QaStreamHandlers = {
  onMeta?: (meta: QaStreamMeta) => void;
  onThinkingDelta?: (text: string) => void;
  onAnswerDelta?: (text: string) => void;
  signal?: AbortSignal;
};

const MAX_HISTORY = 8;
const MAX_CONTENT_PER_MESSAGE = 2500;
const MAX_ARTICLE_CONTEXT = 4;
const DEFAULT_BASE_URL = "https://api.siliconflow.cn/v1";
const DEFAULT_MODEL = "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B";

function createLlm(temperature: number) {
  const apiKey = String(process.env.SILICONFLOW_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("SILICONFLOW_API_KEY is missing.");
  }

  return new ChatOpenAI({
    apiKey,
    model: String(process.env.SILICONFLOW_MODEL || DEFAULT_MODEL).trim(),
    temperature,
    configuration: {
      baseURL: String(process.env.SILICONFLOW_BASE_URL || DEFAULT_BASE_URL).trim(),
    },
  });
}

function getSiliconFlowApiKey() {
  const apiKey = String(process.env.SILICONFLOW_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("SILICONFLOW_API_KEY is missing.");
  }
  return apiKey;
}

function getSiliconFlowModel() {
  return String(process.env.SILICONFLOW_MODEL || DEFAULT_MODEL).trim();
}

function getSiliconFlowBaseUrl() {
  return String(process.env.SILICONFLOW_BASE_URL || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
}

function getChatCompletionsUrl() {
  return `${getSiliconFlowBaseUrl()}/chat/completions`;
}

function normalizeMessages(messages: QaMessage[]) {
  return messages
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({
      role: item.role,
      content: String(item.content || "").trim().slice(0, MAX_CONTENT_PER_MESSAGE),
    }))
    .filter((item) => item.content.length > 0)
    .slice(-MAX_HISTORY);
}

function messagesToTranscript(messages: QaMessage[]) {
  return messages.map((item) => `[${item.role}] ${item.content}`).join("\n");
}

function stripFence(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    return trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  return trimmed;
}

function parsePlannerDecision(raw: string, mode: QaMode): PlannerDecision {
  if (mode === "blog") {
    return { route: "domain", reason: "Forced by blog mode." };
  }
  if (mode === "web") {
    return { route: "general", reason: "Forced by web mode." };
  }

  const cleaned = stripFence(raw);
  const matched = cleaned.match(/\{[\s\S]*\}/);
  if (!matched) {
    return { route: "general", reason: "Planner output is not valid JSON." };
  }

  try {
    const parsed = JSON.parse(matched[0]) as { route?: string; reason?: string };
    const route = parsed.route === "domain" ? "domain" : "general";
    const reason = String(parsed.reason || "").trim() || "Planner did not return reason.";
    return { route, reason };
  } catch {
    return { route: "general", reason: "Planner JSON parsing failed." };
  }
}

function toTerms(query: string) {
  const normalized = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  return Array.from(new Set(normalized)).slice(0, 24);
}

function safeTags(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function articleScore(article: ArticleForContext, terms: string[]) {
  if (terms.length === 0) {
    return 0;
  }
  const haystack = [
    article.title,
    article.category,
    article.excerpt,
    article.content.slice(0, 500),
    safeTags(article.tags).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) continue;
    score += 1;
    if (article.title.toLowerCase().includes(term)) score += 2;
    if (article.excerpt.toLowerCase().includes(term)) score += 1;
  }
  return score;
}

async function loadArticleContext(query: string) {
  const articles = await prisma.article.findMany({
    orderBy: { publishedAt: "desc" },
    take: 24,
    select: {
      id: true,
      title: true,
      slug: true,
      category: true,
      excerpt: true,
      content: true,
      tags: true,
      publishedAt: true,
    },
  });

  const terms = toTerms(query);
  const ranked = articles
    .map((article) => ({
      article,
      score: articleScore(article, terms),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.article.publishedAt.getTime() - a.article.publishedAt.getTime();
    });

  const picked = ranked
    .filter((item) => item.score > 0)
    .slice(0, MAX_ARTICLE_CONTEXT)
    .map((item) => item.article);

  const fallback = picked.length > 0 ? picked : ranked.slice(0, Math.min(3, ranked.length)).map((item) => item.article);

  const references: QaReference[] = fallback.map((article) => ({
    id: article.id,
    title: article.title,
    slug: article.slug,
    publishedAt: article.publishedAt.toISOString(),
  }));

  const contextText = fallback
    .map((article, index) => {
      const tags = safeTags(article.tags);
      const tagsText = tags.length > 0 ? tags.join(", ") : "none";
      return [
        `Article ${index + 1}:`,
        `Title: ${article.title}`,
        `Slug: ${article.slug}`,
        `Category: ${article.category}`,
        `Tags: ${tagsText}`,
        `Excerpt: ${article.excerpt}`,
        `Content preview: ${article.content.slice(0, 700)}`,
      ].join("\n");
    })
    .join("\n\n");

  return { contextText, references };
}

const plannerPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    [
      "You are a routing planner in a multi-agent assistant.",
      "Choose route domain when the user asks about blog/article/SEO/content strategy/editing.",
      "Choose route general for other questions.",
      "Return strict JSON only: {{\"route\":\"domain|general\",\"reason\":\"...\"}}.",
    ].join("\n"),
  ],
  [
    "human",
    [
      "Current mode preference: {mode}",
      "Conversation:",
      "{conversation}",
      "Latest question:",
      "{question}",
    ].join("\n"),
  ],
]);

const domainPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    [
      "You are Domain Agent.",
      "Use the provided blog context as primary evidence.",
      "If context is insufficient, state assumptions clearly.",
      "Answer in Chinese unless user explicitly requests another language.",
    ].join("\n"),
  ],
  [
    "human",
    [
      "Conversation:",
      "{conversation}",
      "Latest question:",
      "{question}",
      "Blog context:",
      "{context}",
    ].join("\n"),
  ],
]);

const generalPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    [
      "You are General Agent.",
      "Give clear, actionable answers.",
      "Answer in Chinese unless user explicitly requests another language.",
    ].join("\n"),
  ],
  [
    "human",
    [
      "Conversation:",
      "{conversation}",
      "Latest question:",
      "{question}",
    ].join("\n"),
  ],
]);

const reviewerPrompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    [
      "You are Reviewer Agent.",
      "Improve the draft answer for clarity and correctness without changing intent.",
      "Keep the response concise and practical.",
      "Output only the final answer text.",
    ].join("\n"),
  ],
  [
    "human",
    [
      "Route: {route}",
      "Planner reason: {reason}",
      "User question: {question}",
      "Draft answer:",
      "{draft}",
    ].join("\n"),
  ],
]);

type SiliconFlowMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function buildDomainStreamMessages(input: {
  conversation: string;
  question: string;
  context: string;
}): SiliconFlowMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are Domain Agent.",
        "Use blog context as primary evidence.",
        "If context is insufficient, state assumptions clearly.",
        "Answer in Chinese unless user explicitly requests another language.",
        "Output format must be: <think>reasoning</think> then final answer.",
        "Do not omit </think>.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "Conversation:",
        input.conversation,
        "Latest question:",
        input.question,
        "Blog context:",
        input.context,
      ].join("\n"),
    },
  ];
}

function buildGeneralStreamMessages(input: {
  conversation: string;
  question: string;
}): SiliconFlowMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are General Agent.",
        "Give clear, actionable answers.",
        "Answer in Chinese unless user explicitly requests another language.",
        "Output format must be: <think>reasoning</think> then final answer.",
        "Do not omit </think>.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        "Conversation:",
        input.conversation,
        "Latest question:",
        input.question,
      ].join("\n"),
    },
  ];
}

async function streamSiliconFlowResponse(input: {
  messages: SiliconFlowMessage[];
  onThinkingDelta?: (text: string) => void;
  onAnswerDelta?: (text: string) => void;
  signal?: AbortSignal;
}) {
  const response = await fetch(getChatCompletionsUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getSiliconFlowApiKey()}`,
    },
    body: JSON.stringify({
      model: getSiliconFlowModel(),
      stream: true,
      temperature: 0.3,
      messages: input.messages,
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`SiliconFlow request failed (${response.status}): ${responseText.slice(0, 300)}`);
  }

  if (!response.body) {
    throw new Error("SiliconFlow stream body is empty.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullAnswer = "";
  let fullThinking = "";

  function consumeEvent(rawEvent: string) {
    const lines = rawEvent.split("\n");
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) return false;

    const dataText = dataLines.join("\n").trim();
    if (!dataText) return false;
    if (dataText === "[DONE]") return true;

    try {
      const payload = JSON.parse(dataText) as {
        choices?: Array<{
          delta?: {
            content?: unknown;
            reasoning_content?: unknown;
          };
        }>;
      };

      const delta = payload.choices?.[0]?.delta;
      const reasoningDelta =
        delta && typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
      const answerDelta = delta && typeof delta.content === "string" ? delta.content : "";

      if (reasoningDelta) {
        fullThinking += reasoningDelta;
        input.onThinkingDelta?.(reasoningDelta);
      }
      if (answerDelta) {
        fullAnswer += answerDelta;
        input.onAnswerDelta?.(answerDelta);
      }
    } catch {
      // Ignore malformed chunks to keep stream resilient.
    }

    return false;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");

    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) break;

      const rawEvent = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);
      if (!rawEvent) continue;
      if (consumeEvent(rawEvent)) {
        return {
          answer: fullAnswer,
          thinking: fullThinking,
        };
      }
    }
  }

  if (buffer.trim()) {
    consumeEvent(buffer.trim());
  }

  return {
    answer: fullAnswer,
    thinking: fullThinking,
  };
}

export async function runQaMultiAgentStream(
  input: {
    messages: QaMessage[];
    mode: QaMode;
  },
  handlers: QaStreamHandlers = {},
): Promise<QaMultiAgentStreamResult> {
  const normalizedMessages = normalizeMessages(input.messages);
  const latestUser = [...normalizedMessages].reverse().find((item) => item.role === "user");
  if (!latestUser) {
    throw new Error("No user message found.");
  }

  const conversation = messagesToTranscript(normalizedMessages);
  const llmPlanner = createLlm(0);
  const parser = new StringOutputParser();
  const plannerChain = plannerPrompt.pipe(llmPlanner).pipe(parser);
  const plannerRaw = await plannerChain.invoke({
    mode: input.mode,
    conversation,
    question: latestUser.content,
  });

  const decision = parsePlannerDecision(plannerRaw, input.mode);
  let references: QaReference[] = [];
  let streamMessages: SiliconFlowMessage[] = [];

  if (decision.route === "domain") {
    const { contextText, references: articleReferences } = await loadArticleContext(latestUser.content);
    references = articleReferences;
    streamMessages = buildDomainStreamMessages({
      conversation,
      question: latestUser.content,
      context: contextText || "No article context found.",
    });
  } else {
    streamMessages = buildGeneralStreamMessages({
      conversation,
      question: latestUser.content,
    });
  }

  handlers.onMeta?.({
    route: decision.route,
    reason: decision.reason,
    references,
  });

  const streamed = await streamSiliconFlowResponse({
    messages: streamMessages,
    signal: handlers.signal,
    onThinkingDelta: handlers.onThinkingDelta,
    onAnswerDelta: handlers.onAnswerDelta,
  });

  return {
    route: decision.route,
    reason: decision.reason,
    references,
    answer: streamed.answer.trim() || "抱歉，我暂时无法生成回答。",
    thinking: streamed.thinking.trim(),
  };
}

export async function runQaMultiAgent(input: {
  messages: QaMessage[];
  mode: QaMode;
}): Promise<QaMultiAgentResult> {
  const normalizedMessages = normalizeMessages(input.messages);
  const latestUser = [...normalizedMessages].reverse().find((item) => item.role === "user");
  if (!latestUser) {
    throw new Error("No user message found.");
  }

  const conversation = messagesToTranscript(normalizedMessages);
  const llmPlanner = createLlm(0);
  const llmResponder = createLlm(0.3);
  const llmReviewer = createLlm(0.1);
  const parser = new StringOutputParser();

  const plannerChain = plannerPrompt.pipe(llmPlanner).pipe(parser);
  const plannerRaw = await plannerChain.invoke({
    mode: input.mode,
    conversation,
    question: latestUser.content,
  });

  const decision = parsePlannerDecision(plannerRaw, input.mode);
  let references: QaReference[] = [];
  let draft = "";

  if (decision.route === "domain") {
    const { contextText, references: articleReferences } = await loadArticleContext(latestUser.content);
    references = articleReferences;
    const domainChain = domainPrompt.pipe(llmResponder).pipe(parser);
    draft = await domainChain.invoke({
      conversation,
      question: latestUser.content,
      context: contextText || "No article context found.",
    });
  } else {
    const generalChain = generalPrompt.pipe(llmResponder).pipe(parser);
    draft = await generalChain.invoke({
      conversation,
      question: latestUser.content,
    });
  }

  const reviewerChain = reviewerPrompt.pipe(llmReviewer).pipe(parser);
  const reviewed = await reviewerChain.invoke({
    route: decision.route,
    reason: decision.reason,
    question: latestUser.content,
    draft,
  });

  const answer = (reviewed || draft || "抱歉，我暂时无法生成回答。").trim();
  return {
    answer,
    route: decision.route,
    reason: decision.reason,
    references,
  };
}
