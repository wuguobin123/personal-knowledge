import { z } from "zod";
import { collectLatestTweets } from "../../../../../../scripts/twitter-collector.mjs";
import { getAdminSession } from "@/lib/auth";

export const runtime = "nodejs";

type CollectOptions = {
  usernames?: string[];
  timeZone?: string;
};

type CollectResult = {
  accounts: number;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  perAccount: Array<{
    username: string;
    fetched: number;
    created: number;
    updated: number;
    skipped: number;
    highestSinceId?: string | null;
    error?: string;
  }>;
};

type GlobalState = typeof globalThis & {
  __twitterManualCollectPromise?: Promise<CollectResult> | null;
  __twitterManualCollectStartedAt?: number;
};

const requestSchema = z
  .object({
    usernames: z.array(z.string().trim().min(1).max(50)).max(100).optional(),
    timeZone: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

function globalState(): GlobalState {
  return globalThis as GlobalState;
}

async function runManualCollection(options: CollectOptions) {
  return collectLatestTweets(options);
}

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const state = globalState();
  const running = Boolean(state.__twitterManualCollectPromise);

  return Response.json({
    running,
    startedAt: running && state.__twitterManualCollectStartedAt ? state.__twitterManualCollectStartedAt : null,
  });
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const state = globalState();
  if (state.__twitterManualCollectPromise) {
    return Response.json(
      {
        error: "A manual Twitter collection task is already running.",
        startedAt: state.__twitterManualCollectStartedAt ?? null,
      },
      { status: 409 },
    );
  }

  let payload: unknown = {};
  try {
    const raw = await request.text();
    payload = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request payload.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const options: CollectOptions = {};
  if (parsed.data.usernames) {
    options.usernames = parsed.data.usernames;
  }
  if (parsed.data.timeZone) {
    options.timeZone = parsed.data.timeZone;
  }

  const startedAt = Date.now();
  const task = runManualCollection(options).finally(() => {
    state.__twitterManualCollectPromise = null;
    state.__twitterManualCollectStartedAt = undefined;
  });

  state.__twitterManualCollectPromise = task;
  state.__twitterManualCollectStartedAt = startedAt;

  try {
    const result = await task;
    const finishedAt = Date.now();
    return Response.json({
      triggeredBy: session.username,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to collect Twitter posts.";
    return Response.json({ error: message, startedAt }, { status: 500 });
  }
}
