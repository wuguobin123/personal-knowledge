import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_QA_SKILL_ID } from "@/lib/qa/skills-catalog";
import { runQaSkillStream } from "@/lib/qa/skills-runtime";
import type { QaMessage } from "@/lib/qa/multi-agent";

export const runtime = "nodejs";

const requestSchema = z.object({
  sessionId: z.number().int().positive().optional(),
  mode: z.enum(["auto", "blog", "web"]).optional().default("auto"),
  skillId: z.string().trim().min(1).max(120).optional().default(DEFAULT_QA_SKILL_ID),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(8000),
      }),
    )
    .min(1)
    .max(32),
});

type RequestPayload = z.infer<typeof requestSchema>;
type ConversationRole = "USER" | "ASSISTANT";
type ConversationMessageStatus = "COMPLETED" | "ERROR";

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function toSkillMode(mode: RequestPayload["mode"]): "AUTO" | "BLOG" | "WEB" {
  if (mode === "blog") return "BLOG";
  if (mode === "web") return "WEB";
  return "AUTO";
}

function getAssistantProvider() {
  return "siliconflow";
}

function getAssistantModel() {
  return String(process.env.SILICONFLOW_MODEL || "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B").trim();
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function pickLatestUserMessage(messages: RequestPayload["messages"]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (item?.role === "user") {
      return item;
    }
  }
  return null;
}

function buildConversationTitle(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "新会话";
  }
  return normalized.slice(0, 80);
}

async function loadShortTermMemoryMessages(conversationId: number, limit = 20): Promise<QaMessage[]> {
  const rows = await prisma.qaConversationMessage.findMany({
    where: {
      conversationId,
      status: "COMPLETED",
      role: {
        in: ["USER", "ASSISTANT"],
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.max(1, Math.min(100, limit)),
    select: {
      role: true,
      content: true,
    },
  });

  return rows
    .reverse()
    .map((item) => ({
      role: item.role === "USER" ? "user" : "assistant",
      content: String(item.content || "").trim(),
    }))
    .filter((item) => item.content.length > 0);
}

async function resolveConversationId(input: {
  sessionId?: number;
  userId: string;
  mode: RequestPayload["mode"];
  skillId: string;
  latestQuestion: string;
}) {
  if (input.sessionId) {
    const conversation = await prisma.qaConversation.findUnique({
      where: { id: input.sessionId },
      select: { id: true, userId: true, status: true },
    });
    if (!conversation || conversation.userId !== input.userId || conversation.status === "DELETED") {
      throw new ApiError(404, "Conversation not found.");
    }
    return conversation.id;
  }

  const created = await prisma.qaConversation.create({
    data: {
      userId: input.userId,
      title: buildConversationTitle(input.latestQuestion),
      status: "ACTIVE",
      mode: toSkillMode(input.mode),
      skillId: input.skillId,
      meta: {
        source: "qa-api",
        createdMode: input.mode,
        createdSkillId: input.skillId,
      },
    },
    select: { id: true },
  });
  return created.id;
}

async function appendConversationMessage(input: {
  conversationId: number;
  parentMessageId?: number | null;
  userId: string;
  role: ConversationRole;
  status?: ConversationMessageStatus;
  content: string;
  reasoning?: string | null;
  mode: RequestPayload["mode"];
  skillId: string;
  provider?: string | null;
  model?: string | null;
  finishReason?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  latencyMs?: number | null;
  errorMessage?: string | null;
  meta?: Prisma.InputJsonValue;
}) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const created = await tx.qaConversationMessage.create({
      data: {
        conversationId: input.conversationId,
        parentMessageId: input.parentMessageId ?? null,
        userId: input.userId,
        role: input.role,
        status: input.status || "COMPLETED",
        content: input.content,
        reasoning: input.reasoning ?? null,
        mode: toSkillMode(input.mode),
        skillId: input.skillId,
        provider: input.provider ?? null,
        model: input.model ?? null,
        finishReason: input.finishReason ?? null,
        promptTokens: input.promptTokens ?? null,
        completionTokens: input.completionTokens ?? null,
        totalTokens: input.totalTokens ?? null,
        latencyMs: input.latencyMs ?? null,
        errorMessage: input.errorMessage ?? null,
        ...(input.meta !== undefined ? { meta: input.meta } : {}),
      },
      select: { id: true },
    });

    await tx.qaConversation.update({
      where: { id: input.conversationId },
      data: {
        status: "ACTIVE",
        mode: toSkillMode(input.mode),
        skillId: input.skillId,
        lastMessageAt: now,
        messageCount: {
          increment: 1,
        },
      },
    });
    return created;
  });
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const payload = await request.json();
    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid request payload.", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const latestUserMessage = pickLatestUserMessage(parsed.data.messages);
    if (!latestUserMessage) {
      return Response.json({ error: "No user message found." }, { status: 400 });
    }

    const conversationId = await resolveConversationId({
      sessionId: parsed.data.sessionId,
      userId: session.username,
      mode: parsed.data.mode,
      skillId: parsed.data.skillId,
      latestQuestion: latestUserMessage.content,
    });

    const savedUserMessage = await appendConversationMessage({
      conversationId,
      userId: session.username,
      role: "USER",
      status: "COMPLETED",
      content: latestUserMessage.content,
      mode: parsed.data.mode,
      skillId: parsed.data.skillId,
    });
    const userMessageId = savedUserMessage.id;
    const shortTermMessages = await loadShortTermMemoryMessages(conversationId, 20);

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const assistantStartedAt = Date.now();

        function push(event: string, data: unknown) {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        }

        function pushChars(event: "thinking_delta" | "answer_delta", text: string) {
          for (const char of Array.from(text)) {
            push(event, { text: char });
          }
        }

        try {
          const result = await runQaSkillStream(
            {
              mode: parsed.data.mode,
              messages: shortTermMessages.length > 0 ? shortTermMessages : parsed.data.messages,
              skillId: parsed.data.skillId,
            },
            {
              signal: request.signal,
              onMeta(meta) {
                push("meta", meta);
              },
              onThinkingDelta(text) {
                pushChars("thinking_delta", text);
              },
              onAnswerDelta(text) {
                pushChars("answer_delta", text);
              },
            },
          );

          await appendConversationMessage({
            conversationId,
            parentMessageId: userMessageId,
            userId: session.username,
            role: "ASSISTANT",
            status: "COMPLETED",
            content: result.answer,
            reasoning: result.thinking || null,
            mode: parsed.data.mode,
            skillId: parsed.data.skillId,
            provider: getAssistantProvider(),
            model: getAssistantModel(),
            finishReason: "stop",
            latencyMs: Math.max(0, Date.now() - assistantStartedAt),
            meta: toPrismaJson({
              route: result.route,
              reason: result.reason,
              references: result.references,
              skillId: result.skillId,
              skillLabel: result.skillLabel,
              skillDescription: result.skillDescription,
              mcpUsed: result.mcpUsed,
              mcpModuleKey: result.mcpModuleKey,
              mcpModuleLabel: result.mcpModuleLabel,
              mcpToolName: result.mcpToolName,
              mcpReason: result.mcpReason,
              mcpError: result.mcpError,
            }),
          });

          push("done", result);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to run Q&A assistant.";
          try {
            await appendConversationMessage({
              conversationId,
              parentMessageId: userMessageId,
              userId: session.username,
              role: "ASSISTANT",
              status: "ERROR",
              content: "",
              mode: parsed.data.mode,
              skillId: parsed.data.skillId,
              provider: getAssistantProvider(),
              model: getAssistantModel(),
              finishReason: "error",
              latencyMs: Math.max(0, Date.now() - assistantStartedAt),
              errorMessage: message.slice(0, 1000),
              meta: toPrismaJson({
                error: true,
              }),
            });
          } catch {
            // Ignore persistence errors to avoid breaking the SSE error response.
          }
          push("error", { message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-QA-Session-Id": String(conversationId),
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to run Q&A assistant.";
    return Response.json({ error: message }, { status: 500 });
  }
}
