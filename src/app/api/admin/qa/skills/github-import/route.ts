import { z } from "zod";
import { getAdminSession } from "@/lib/auth";
import { createGithubQaSkill, toQaSkillOption } from "@/lib/qa/custom-skills";
import { buildGithubSkillDraft, loadGithubRepoForSkill } from "@/lib/qa/github-skills";

export const runtime = "nodejs";

const importSchema = z.object({
  owner: z.string().trim().min(1).max(100),
  repo: z.string().trim().min(1).max(100),
  modeHint: z.enum(["auto", "blog", "web"]).optional().default("auto"),
});

function formatErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "Failed to import GitHub skill.";
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

  const parsed = importSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request payload.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const repoInfo = await loadGithubRepoForSkill(parsed.data.owner, parsed.data.repo);
    const draft = buildGithubSkillDraft({
      fullName: repoInfo.fullName,
      description: repoInfo.description,
      htmlUrl: repoInfo.htmlUrl,
      language: repoInfo.language,
      topics: repoInfo.topics,
      stars: repoInfo.stars,
      readmeSnippet: repoInfo.readmeSnippet,
      modeHint: parsed.data.modeHint,
    });

    const imported = await createGithubQaSkill({
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      label: draft.label,
      description: draft.description,
      instruction: draft.instruction,
      modeHint: draft.modeHint,
      githubUrl: repoInfo.htmlUrl,
      stars: repoInfo.stars,
    });

    return Response.json({
      created: imported.created,
      skill: toQaSkillOption(imported.skill),
    });
  } catch (error) {
    return Response.json({ error: formatErrorMessage(error) }, { status: 500 });
  }
}
