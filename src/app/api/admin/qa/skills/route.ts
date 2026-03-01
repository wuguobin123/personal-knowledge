import { z } from "zod";
import { getAdminSession } from "@/lib/auth";
import { createManualQaSkill, listQaSkillsWithCustom, toQaSkillOption } from "@/lib/qa/custom-skills";

export const runtime = "nodejs";

const createSkillSchema = z.object({
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(400).optional(),
  modeHint: z.enum(["auto", "blog", "web"]).optional().default("auto"),
  instruction: z.string().trim().min(12).max(12000),
});
const listSkillQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(30).optional().default(8),
  q: z.string().trim().max(80).optional().default(""),
});

function formatErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Failed to process skill request.";
}

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsedQuery = listSkillQuerySchema.safeParse({
    page: searchParams.get("page") || undefined,
    pageSize: searchParams.get("pageSize") || undefined,
    q: searchParams.get("q") || "",
  });
  if (!parsedQuery.success) {
    return Response.json(
      { error: "Invalid request query.", details: parsedQuery.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const allSkills = await listQaSkillsWithCustom();
    const keyword = parsedQuery.data.q.toLowerCase();
    const filteredSkills = keyword
      ? allSkills.filter((skill) =>
          [skill.id, skill.label, skill.description]
            .map((value) => value.toLowerCase())
            .some((value) => value.includes(keyword)),
        )
      : allSkills;
    const total = filteredSkills.length;
    const totalPages = Math.max(1, Math.ceil(total / parsedQuery.data.pageSize));
    const page = Math.min(parsedQuery.data.page, totalPages);
    const offset = (page - 1) * parsedQuery.data.pageSize;
    const skills = filteredSkills.slice(offset, offset + parsedQuery.data.pageSize);

    return Response.json({
      skills,
      total,
      totalPages,
      page,
      pageSize: parsedQuery.data.pageSize,
      q: parsedQuery.data.q,
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

  const parsed = createSkillSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request payload.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const description = parsed.data.description?.trim() || `${parsed.data.label} (自定义 Skill)`;

  try {
    const created = await createManualQaSkill({
      label: parsed.data.label,
      description,
      instruction: parsed.data.instruction,
      modeHint: parsed.data.modeHint,
    });

    return Response.json({
      skill: toQaSkillOption(created),
    });
  } catch (error) {
    return Response.json({ error: formatErrorMessage(error) }, { status: 500 });
  }
}
