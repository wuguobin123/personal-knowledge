import { z } from "zod";
import { getAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEFAULT_QA_SKILL_ID } from "@/lib/qa/skills-catalog";

const createSessionSchema = z.object({
  title: z.string().trim().max(200).optional(),
  mode: z.enum(["auto", "blog", "web"]).optional().default("auto"),
  skillId: z.string().trim().min(1).max(120).optional().default(DEFAULT_QA_SKILL_ID),
});

const listSessionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

function toSkillMode(mode: "auto" | "blog" | "web") {
  if (mode === "blog") return "BLOG" as const;
  if (mode === "web") return "WEB" as const;
  return "AUTO" as const;
}

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

function normalizeTitle(raw?: string) {
  const text = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
  return text || "新会话";
}

function formatSessionError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Failed to load sessions.";
}

export async function GET(request: Request) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    const parsed = listSessionQuerySchema.safeParse({
      limit: new URL(request.url).searchParams.get("limit") || undefined,
    });
    if (!parsed.success) {
      return Response.json(
        { error: "Invalid request query.", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const sessions = await prisma.qaConversation.findMany({
      where: {
        userId: session.username,
        status: {
          not: "DELETED",
        },
      },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: parsed.data.limit,
      select: {
        id: true,
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

    return Response.json({
      sessions: sessions.map((item) => ({
        id: item.id,
        title: item.title,
        status: fromConversationStatus(item.status),
        mode: fromSkillMode(item.mode),
        skillId: item.skillId,
        messageCount: item.messageCount,
        lastMessageAt: item.lastMessageAt.toISOString(),
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    return Response.json({ error: formatSessionError(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = createSessionSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request payload.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const created = await prisma.qaConversation.create({
      data: {
        userId: session.username,
        title: normalizeTitle(parsed.data.title),
        status: "ACTIVE",
        mode: toSkillMode(parsed.data.mode),
        skillId: parsed.data.skillId,
        meta: {
          source: "qa-session-api",
          createdMode: parsed.data.mode,
          createdSkillId: parsed.data.skillId,
        },
      },
      select: {
        id: true,
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

    return Response.json({
      session: {
        id: created.id,
        title: created.title,
        status: fromConversationStatus(created.status),
        mode: fromSkillMode(created.mode),
        skillId: created.skillId,
        messageCount: created.messageCount,
        lastMessageAt: created.lastMessageAt.toISOString(),
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create session.";
    return Response.json({ error: message }, { status: 500 });
  }
}
