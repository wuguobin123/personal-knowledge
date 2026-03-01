import { z } from "zod";
import { getAdminSession } from "@/lib/auth";
import { DEFAULT_QA_SKILL_ID } from "@/lib/qa/skills-catalog";
import { runQaSkillStream } from "@/lib/qa/skills-runtime";

export const runtime = "nodejs";

const requestSchema = z.object({
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

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
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
              messages: parsed.data.messages,
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

          push("done", result);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to run Q&A assistant.";
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
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run Q&A assistant.";
    return Response.json({ error: message }, { status: 500 });
  }
}
