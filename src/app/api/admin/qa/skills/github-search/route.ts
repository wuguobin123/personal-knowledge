import { z } from "zod";
import { getAdminSession } from "@/lib/auth";
import { searchGithubSkills } from "@/lib/qa/github-skills";

export const runtime = "nodejs";

const querySchema = z.object({
  q: z.string().trim().min(2).max(80),
  minStars: z.coerce.number().int().min(0).max(1000000).optional().default(500),
  limit: z.coerce.number().int().min(1).max(20).optional().default(8),
});

function formatErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Failed to search GitHub skills.";
}

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    q: searchParams.get("q") || "",
    minStars: searchParams.get("minStars") || undefined,
    limit: searchParams.get("limit") || undefined,
  });

  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request query.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const items = await searchGithubSkills({
      query: parsed.data.q,
      minStars: parsed.data.minStars,
      limit: parsed.data.limit,
    });
    return Response.json({ items });
  } catch (error) {
    return Response.json({ error: formatErrorMessage(error) }, { status: 500 });
  }
}
