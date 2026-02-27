import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { getAdminSession } from "@/lib/auth";

export const runtime = "nodejs";

type CollectOptions = {
  targetDateKey?: string;
  timeZone?: string;
};

type CollectResult = {
  targetDateKey: string;
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
};

type CollectorModule = {
  collectDailyAiNews: (options?: CollectOptions) => Promise<CollectResult>;
};

type GlobalState = typeof globalThis & {
  __aiNewsManualCollectPromise?: Promise<CollectResult> | null;
  __aiNewsManualCollectStartedAt?: number;
};

const requestSchema = z
  .object({
    targetDateKey: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    timeZone: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

function globalState(): GlobalState {
  return globalThis as GlobalState;
}

async function loadCollectorModule(): Promise<CollectorModule> {
  const modulePath = pathToFileURL(path.join(process.cwd(), "scripts/ai-news-collector.mjs")).href;
  const imported = (await import(modulePath)) as Partial<CollectorModule>;
  if (typeof imported.collectDailyAiNews !== "function") {
    throw new Error("collectDailyAiNews is not available.");
  }

  return imported as CollectorModule;
}

async function runManualCollection(options: CollectOptions) {
  const collector = await loadCollectorModule();
  return collector.collectDailyAiNews(options);
}

export async function GET() {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const state = globalState();
  const running = Boolean(state.__aiNewsManualCollectPromise);

  return Response.json({
    running,
    startedAt: running && state.__aiNewsManualCollectStartedAt ? state.__aiNewsManualCollectStartedAt : null,
  });
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const state = globalState();
  if (state.__aiNewsManualCollectPromise) {
    return Response.json(
      {
        error: "A manual AI news collection task is already running.",
        startedAt: state.__aiNewsManualCollectStartedAt ?? null,
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
  if (parsed.data.targetDateKey) {
    options.targetDateKey = parsed.data.targetDateKey;
  }
  if (parsed.data.timeZone) {
    options.timeZone = parsed.data.timeZone;
  }

  const startedAt = Date.now();
  const task = runManualCollection(options).finally(() => {
    state.__aiNewsManualCollectPromise = null;
    state.__aiNewsManualCollectStartedAt = undefined;
  });

  state.__aiNewsManualCollectPromise = task;
  state.__aiNewsManualCollectStartedAt = startedAt;

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
    const message = error instanceof Error ? error.message : "Failed to collect AI news.";
    return Response.json({ error: message, startedAt }, { status: 500 });
  }
}
