import { z } from "zod";
import { getAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const updateAccountSchema = z.object({
  enabled: z.boolean().optional(),
}).strict().refine((value) => value.enabled !== undefined, {
  message: "At least one field must be provided.",
});

type RouteContext = {
  params: Promise<{
    accountId: string;
  }>;
};

function formatErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Failed to process Twitter watch account request.";
}

function parseAccountId(value: string) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

async function resolveAccountId(context: RouteContext) {
  const { accountId } = await context.params;
  const parsed = parseAccountId(accountId);
  if (!parsed) {
    throw new Error("Invalid account id.");
  }
  return parsed;
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let accountId = 0;
  try {
    accountId = await resolveAccountId(context);
  } catch (error) {
    return Response.json({ error: formatErrorMessage(error) }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = updateAccountSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request payload.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const account = await prisma.twitterWatchAccount.update({
      where: {
        id: accountId,
      },
      data: {
        ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
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

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let accountId = 0;
  try {
    accountId = await resolveAccountId(context);
  } catch (error) {
    return Response.json({ error: formatErrorMessage(error) }, { status: 400 });
  }

  try {
    await prisma.twitterWatchAccount.delete({
      where: {
        id: accountId,
      },
    });

    return Response.json({
      success: true,
    });
  } catch (error) {
    return Response.json({ error: formatErrorMessage(error) }, { status: 500 });
  }
}
