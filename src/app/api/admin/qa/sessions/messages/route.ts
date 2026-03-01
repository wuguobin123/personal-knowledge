import { z } from "zod";
import { getAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const querySchema = z.object({
  sessionId: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(300),
});

function fromSkillMode(mode: "AUTO" | "BLOG" | "WEB") {
  if (mode === "BLOG") return "blog" as const;
  if (mode === "WEB") return "web" as const;
  return "auto" as const;
}

function fromConversationStatus(status: "ACTIVE" | "ARCHIVED" | "DELETED") {
  if (status === "ARCHIVED") return "archived" as const;
  if (status === "DELETED") return "deleted" as const;
  return "active" as const;
}

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    sessionId: url.searchParams.get("sessionId") || undefined,
    limit: url.searchParams.get("limit") || undefined,
  });

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request query.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const conversation = await prisma.qaConversation.findUnique({
    where: { id: parsed.data.sessionId },
    select: {
      id: true,
      userId: true,
      title: true,
      status: true,
      mode: true,
      skillId: true,
      messageCount: true,
      lastMessageAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!conversation || conversation.userId !== session.username || conversation.status === "DELETED") {
    return Response.json({ error: "Session not found." }, { status: 404 });
  }

  const messages = await prisma.qaConversationMessage.findMany({
    where: {
      conversationId: conversation.id,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: parsed.data.limit,
    select: {
      id: true,
      role: true,
      status: true,
      content: true,
      reasoning: true,
      mode: true,
      skillId: true,
      provider: true,
      model: true,
      finishReason: true,
      promptTokens: true,
      completionTokens: true,
      totalTokens: true,
      latencyMs: true,
      errorMessage: true,
      meta: true,
      createdAt: true,
    },
  });

  return Response.json({
    session: {
      id: conversation.id,
      title: conversation.title,
      status: fromConversationStatus(conversation.status),
      mode: fromSkillMode(conversation.mode),
      skillId: conversation.skillId,
      messageCount: conversation.messageCount,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    },
    messages: messages.map((item) => ({
      id: item.id,
      role: item.role,
      status: item.status,
      content: item.content,
      reasoning: item.reasoning,
      mode: fromSkillMode(item.mode),
      skillId: item.skillId,
      provider: item.provider,
      model: item.model,
      finishReason: item.finishReason,
      promptTokens: item.promptTokens,
      completionTokens: item.completionTokens,
      totalTokens: item.totalTokens,
      latencyMs: item.latencyMs,
      errorMessage: item.errorMessage,
      meta: item.meta,
      createdAt: item.createdAt.toISOString(),
    })),
  });
}
