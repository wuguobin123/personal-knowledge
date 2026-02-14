import { Prisma, type ArticleSourceType } from "@prisma/client";
import { getAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function toSlug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const sourceTypeSet = new Set<ArticleSourceType>([
  "ORIGINAL",
  "CRAWLER",
  "TRANSCRIPT",
]);

function normalizeCategory(input: unknown) {
  const category = String(input ?? "").trim();
  return (category || "未分类").slice(0, 80);
}

function normalizeTags(input: unknown) {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[,，\n]/g)
      : [];
  const tags = new Set<string>();

  for (const item of raw) {
    const tag = String(item ?? "").trim().slice(0, 40);
    if (tag) {
      tags.add(tag);
    }
  }

  return Array.from(tags).slice(0, 12);
}

function normalizeSourceType(input: unknown): ArticleSourceType {
  const sourceType = String(input ?? "").trim().toUpperCase() as ArticleSourceType;
  return sourceTypeSet.has(sourceType) ? sourceType : "ORIGINAL";
}

function normalizeSourceDetail(input: unknown) {
  const detail = String(input ?? "").trim().slice(0, 500);
  return detail || null;
}

function jsonToTags(tags: Prisma.JsonValue | null) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

const articleSelect = {
  id: true,
  title: true,
  slug: true,
  category: true,
  tags: true,
  sourceType: true,
  sourceDetail: true,
} as const;

export async function GET() {
  const articles = await prisma.article.findMany({
    where: { published: true },
    orderBy: { publishedAt: "desc" },
    select: {
      id: true,
      title: true,
      slug: true,
      category: true,
      tags: true,
      sourceType: true,
      sourceDetail: true,
      excerpt: true,
      publishedAt: true,
    },
  });

  return Response.json(
    articles.map((article) => ({
      ...article,
      tags: jsonToTags(article.tags),
    })),
  );
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const payload = await request.json();
  const requestedId = Number(payload.id);
  const articleId = Number.isInteger(requestedId) && requestedId > 0 ? requestedId : null;
  const title = String(payload.title || "").trim();
  const excerpt = String(payload.excerpt || "").trim();
  const content = String(payload.content || "").trim();
  const published = payload.published !== false;
  const customSlug = String(payload.slug || "").trim();
  const category = normalizeCategory(payload.category);
  const tags = normalizeTags(payload.tags);
  const sourceType = normalizeSourceType(payload.sourceType);
  const sourceDetail = normalizeSourceDetail(payload.sourceDetail);
  const normalizedSlug = customSlug ? toSlug(customSlug) : toSlug(title);
  const slug = normalizedSlug || `article-${Date.now()}`;

  if (!title || !excerpt || !content) {
    return Response.json(
      { error: "title/excerpt/content are required." },
      { status: 400 },
    );
  }

  try {
    const data = {
      title,
      slug,
      category,
      tags: tags.length > 0 ? tags : Prisma.JsonNull,
      sourceType,
      sourceDetail,
      excerpt,
      content,
      published,
    };

    const article = articleId
      ? await prisma.article.update({
          where: { id: articleId },
          data,
          select: articleSelect,
        })
      : await prisma.article.create({
          data,
          select: articleSelect,
        });

    return Response.json(
      { ...article, tags: jsonToTags(article.tags), updated: Boolean(articleId) },
      { status: articleId ? 200 : 201 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return Response.json(
        { error: `slug "${slug}" already exists.` },
        { status: 409 },
      );
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return Response.json({ error: "Article not found." }, { status: 404 });
    }

    return Response.json({ error: "Failed to save article." }, { status: 500 });
  }
}
