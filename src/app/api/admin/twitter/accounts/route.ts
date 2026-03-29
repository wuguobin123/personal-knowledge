import { z } from "zod";
import { getAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const createAccountSchema = z.object({
  username: z.string().trim().min(1).max(50),
}).strict();

function formatErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Failed to process Twitter watch account request.";
}

function normalizeUsername(value: string) {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const accounts = await prisma.twitterWatchAccount.findMany({
      orderBy: [{ enabled: "desc" }, { username: "asc" }],
      select: {
        id: true,
        username: true,
        userIdStr: true,
        lastSinceId: true,
        enabled: true,
        includeReplies: true,
        includeRetweets: true,
        lastSyncedAt: true,
        lastProfileSyncedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return Response.json({
      accounts,
    });
  } catch (error) {
    return Response.json({ error: formatErrorMessage(error) }, { status: 500 });
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
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = createAccountSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request payload.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const username = normalizeUsername(parsed.data.username);
  if (!username) {
    return Response.json({ error: "Username is required." }, { status: 400 });
  }

  try {
    const account = await prisma.twitterWatchAccount.upsert({
      where: {
        username,
      },
      update: {
        enabled: true,
      },
      create: {
        username,
        enabled: true,
      },
      select: {
        id: true,
        username: true,
        userIdStr: true,
        lastSinceId: true,
        enabled: true,
        includeReplies: true,
        includeRetweets: true,
        lastSyncedAt: true,
        lastProfileSyncedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return Response.json({
      account,
    });
  } catch (error) {
    return Response.json({ error: formatErrorMessage(error) }, { status: 500 });
  }
}
