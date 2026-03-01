import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import AdminEditor from "./admin-editor";
import QaAssistant from "./qa-assistant";
import { ADMIN_SESSION_COOKIE, getAdminSession, shouldUseSecureCookies } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ view?: string; newsId?: string; page?: string }>;
};

type AdminView = "list" | "write" | "qa" | "ainews" | "settings";

type ArticleRow = {
  id: number;
  title: string;
  slug: string;
  category: string;
  publishedAt: Date;
  published: boolean;
};

type AiNewsRow = {
  id: number;
  title: string;
  source: string;
  category: string;
  url: string;
  newsDate: Date;
  fetchedAt: Date;
  canPublish: boolean;
};

type AiNewsDetail = AiNewsRow & {
  summary: string | null;
  externalId: string | null;
  stars: number | null;
  language: string | null;
  tags: unknown;
  raw: unknown;
};

type AiNewsRawRow = {
  id: number;
  title: string;
  source: string;
  category: string;
  url: string;
  newsDate: Date | string;
  fetchedAt: Date | string;
  canPublish: boolean | number | string;
  summary?: string | null;
  externalId?: string | null;
  stars?: number | null;
  language?: string | null;
  tags?: unknown;
  raw?: unknown;
};

const TABLE_IMAGES = [
  "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?auto=format&fit=crop&w=400&q=80",
  "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=400&q=80",
  "https://images.unsplash.com/photo-1518773553398-650c184e0bb3?auto=format&fit=crop&w=400&q=80",
  "https://images.unsplash.com/photo-1461749280684-dccba630e2f6?auto=format&fit=crop&w=400&q=80",
  "https://images.unsplash.com/photo-1517430816045-df4b7de11d1d?auto=format&fit=crop&w=400&q=80",
];

const AI_NEWS_PAGE_SIZE = 10;
const ARTICLE_PAGE_SIZE = 4;

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function imageForSeed(seed: string) {
  const hash = seed.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return TABLE_IMAGES[hash % TABLE_IMAGES.length];
}

function categoryToneClass(category: string) {
  const normalized = category.toLowerCase();
  if (normalized.includes("design")) return "is-design";
  if (normalized.includes("life")) return "is-lifestyle";
  return "is-technology";
}

function aiNewsCategoryLabel(category: string) {
  if (category === "MODEL_RELEASE") return "Model Release";
  if (category === "GITHUB_PROJECT") return "GitHub Project";
  return "General News";
}

function aiNewsCategoryToneClass(category: string) {
  if (category === "GITHUB_PROJECT") return "is-design";
  if (category === "MODEL_RELEASE") return "is-technology";
  return "is-lifestyle";
}

function parsePositiveInt(value?: string) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatJson(value: unknown) {
  if (value == null) return "-";

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatTags(value: unknown) {
  if (Array.isArray(value)) {
    const tags = value.map((item) => String(item).trim()).filter(Boolean);
    return tags.length > 0 ? tags.join(", ") : "-";
  }

  if (typeof value === "string") {
    return value;
  }

  return "-";
}

function toDate(value: Date | string) {
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

function toBoolean(value: unknown) {
  if (value === true || value === 1 || value === "1") {
    return true;
  }
  return false;
}

function toNumber(value: unknown) {
  if (typeof value === "bigint") {
    return Number(value);
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAiNewsRow(row: AiNewsRawRow): AiNewsRow {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    category: row.category,
    url: row.url,
    newsDate: toDate(row.newsDate),
    fetchedAt: toDate(row.fetchedAt),
    canPublish: toBoolean(row.canPublish),
  };
}

function normalizeAiNewsDetail(row: AiNewsRawRow): AiNewsDetail {
  return {
    ...normalizeAiNewsRow(row),
    summary: row.summary ?? null,
    externalId: row.externalId ?? null,
    stars: row.stars ?? null,
    language: row.language ?? null,
    tags: row.tags ?? null,
    raw: row.raw ?? null,
  };
}

function buildAiNewsHref(page: number, newsId?: number) {
  const params = new URLSearchParams({
    view: "ainews",
    page: String(page),
  });
  if (newsId != null) {
    params.set("newsId", String(newsId));
  }
  return `/admin?${params.toString()}`;
}

function buildArticleListHref(page: number) {
  const params = new URLSearchParams({
    view: "list",
    page: String(page),
  });
  return `/admin?${params.toString()}`;
}

function buildPageNumbers(current: number, total: number) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, idx) => idx + 1);
  }

  const pages: number[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  if (start > 2) {
    pages.push(-1);
  }
  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }
  if (end < total - 1) {
    pages.push(-2);
  }
  pages.push(total);
  return pages;
}

function normalizeView(view?: string): AdminView {
  if (view === "write" || view === "qa" || view === "settings" || view === "list" || view === "ainews") {
    return view;
  }
  return "list";
}

function viewLabel(view: AdminView) {
  if (view === "write") return "Write Post";
  if (view === "qa") return "Q&A Assistant";
  if (view === "ainews") return "AI News";
  if (view === "settings") return "Settings";
  return "Blog List";
}

async function logoutAction() {
  "use server";
  const cookieStore = await cookies();
  const headerStore = await headers();
  const secureCookie = shouldUseSecureCookies({
    forwardedProto: headerStore.get("x-forwarded-proto"),
  });

  cookieStore.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    path: "/",
    maxAge: 0,
  });
  redirect("/admin/login");
}

export default async function AdminPage({ searchParams }: Props) {
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  const { view: viewParam, newsId: newsIdParam, page: pageParam } = await searchParams;
  const view = normalizeView(viewParam);
  const selectedNewsId = view === "ainews" ? parsePositiveInt(newsIdParam) : null;
  const requestedAiNewsPage = view === "ainews" ? parsePositiveInt(pageParam) ?? 1 : 1;
  const requestedArticlePage = view === "list" ? parsePositiveInt(pageParam) ?? 1 : 1;

  let articles: ArticleRow[] = [];
  let articleTotalCount = 0;
  let articlePage = requestedArticlePage;
  let articleTotalPages = 1;
  let publishedCount = 0;
  let aiNews: AiNewsRow[] = [];
  let aiNewsTotalCount = 0;
  let aiNewsPage = requestedAiNewsPage;
  let aiNewsTotalPages = 1;
  let selectedNews: AiNewsDetail | null = null;

  if (view === "list") {
    [articleTotalCount, publishedCount] = await Promise.all([
      prisma.article.count(),
      prisma.article.count({ where: { published: true } }),
    ]);

    articleTotalPages = Math.max(1, Math.ceil(articleTotalCount / ARTICLE_PAGE_SIZE));
    articlePage = Math.min(requestedArticlePage, articleTotalPages);
    const articleOffset = (articlePage - 1) * ARTICLE_PAGE_SIZE;

    articles = await prisma.article.findMany({
      orderBy: { publishedAt: "desc" },
      skip: articleOffset,
      take: ARTICLE_PAGE_SIZE,
      select: {
        id: true,
        title: true,
        slug: true,
        category: true,
        publishedAt: true,
        published: true,
      },
    });
  }
  if (view === "ainews") {
    const aiNewsDelegate = (
      prisma as unknown as {
        aiNewsItem?: {
          findMany: (args: unknown) => Promise<AiNewsRawRow[]>;
          count: (args: unknown) => Promise<number>;
          findFirst: (args: unknown) => Promise<AiNewsRawRow | null>;
        };
      }
    ).aiNewsItem;

    if (aiNewsDelegate) {
      const [total, detail] = await Promise.all([
        aiNewsDelegate.count({
          where: { isDeleted: false },
        }),
        selectedNewsId == null
          ? Promise.resolve(null)
          : aiNewsDelegate.findFirst({
              where: {
                id: selectedNewsId,
                isDeleted: false,
              },
              select: {
                id: true,
                title: true,
                summary: true,
                source: true,
                category: true,
                url: true,
                externalId: true,
                stars: true,
                language: true,
                tags: true,
                newsDate: true,
                fetchedAt: true,
                canPublish: true,
                raw: true,
              },
            }),
      ]);

      aiNewsTotalCount = total;
      aiNewsTotalPages = Math.max(1, Math.ceil(aiNewsTotalCount / AI_NEWS_PAGE_SIZE));
      aiNewsPage = Math.min(requestedAiNewsPage, aiNewsTotalPages);
      const aiNewsOffset = (aiNewsPage - 1) * AI_NEWS_PAGE_SIZE;
      const rows = await aiNewsDelegate.findMany({
        where: { isDeleted: false },
        orderBy: [{ newsDate: "desc" }, { id: "desc" }],
        skip: aiNewsOffset,
        take: AI_NEWS_PAGE_SIZE,
        select: {
          id: true,
          title: true,
          source: true,
          category: true,
          url: true,
          newsDate: true,
          fetchedAt: true,
          canPublish: true,
        },
      });

      aiNews = rows.map(normalizeAiNewsRow);
      selectedNews = detail ? normalizeAiNewsDetail(detail) : null;
    } else {
      const [totalRows, detailRows] = await Promise.all([
        prisma.$queryRaw<Array<{ total: number | string | bigint }>>`
          SELECT COUNT(*) AS total
          FROM AiNewsItem
          WHERE isDeleted = 0
        `,
        selectedNewsId == null
          ? Promise.resolve([] as AiNewsRawRow[])
          : prisma.$queryRaw<AiNewsRawRow[]>`
              SELECT
                id, title, summary, source, category, url, externalId, stars, language, tags,
                newsDate, fetchedAt, canPublish, raw
              FROM AiNewsItem
              WHERE id = ${selectedNewsId} AND isDeleted = 0
              LIMIT 1
            `,
      ]);

      aiNewsTotalCount = toNumber(totalRows[0]?.total);
      aiNewsTotalPages = Math.max(1, Math.ceil(aiNewsTotalCount / AI_NEWS_PAGE_SIZE));
      aiNewsPage = Math.min(requestedAiNewsPage, aiNewsTotalPages);
      const aiNewsOffset = (aiNewsPage - 1) * AI_NEWS_PAGE_SIZE;
      const rows = await prisma.$queryRaw<AiNewsRawRow[]>`
        SELECT id, title, source, category, url, newsDate, fetchedAt, canPublish
        FROM AiNewsItem
        WHERE isDeleted = 0
        ORDER BY newsDate DESC, id DESC
        LIMIT ${AI_NEWS_PAGE_SIZE} OFFSET ${aiNewsOffset}
      `;

      aiNews = rows.map(normalizeAiNewsRow);
      selectedNews = detailRows.length > 0 ? normalizeAiNewsDetail(detailRows[0]) : null;
    }
  }

  const articleRows = articles;
  const aiNewsRows = aiNews;
  const articleOffset = (articlePage - 1) * ARTICLE_PAGE_SIZE;
  const articleShownStart = articleTotalCount > 0 ? articleOffset + 1 : 0;
  const articleShownEnd = articleTotalCount > 0 ? Math.min(articleOffset + articleRows.length, articleTotalCount) : 0;
  const articlePageNumbers = buildPageNumbers(articlePage, articleTotalPages);
  const aiNewsOffset = (aiNewsPage - 1) * AI_NEWS_PAGE_SIZE;
  const aiNewsShownStart = aiNewsTotalCount > 0 ? aiNewsOffset + 1 : 0;
  const aiNewsShownEnd = aiNewsTotalCount > 0 ? Math.min(aiNewsOffset + aiNewsRows.length, aiNewsTotalCount) : 0;
  const aiNewsPageNumbers = buildPageNumbers(aiNewsPage, aiNewsTotalPages);
  const draftCount = Math.max(0, articleTotalCount - publishedCount);
  const totalPageViews = articleTotalCount * 3121 + 7000;
  const activeComments = Math.max(0, publishedCount * 29 - 16);

  return (
    <div className="admin-dash-page">
      <aside className="admin-dash-sidebar">
        <div className="admin-dash-brand">
          <span>B</span>
          <h1>BlogAdmin</h1>
        </div>

        <nav className="admin-dash-nav">
          <Link href="/admin?view=write" className={view === "write" ? "is-active" : undefined}>
            Write Post
          </Link>
          <Link href="/admin?view=list" className={view === "list" ? "is-active" : undefined}>
            Blog List
          </Link>
          <Link href="/admin?view=ainews" className={view === "ainews" ? "is-active" : undefined}>
            AI News
          </Link>
          <Link href="/admin?view=qa" className={view === "qa" ? "is-active" : undefined}>
            Q&amp;A Assistant
          </Link>
          <Link href="/admin?view=settings" className={view === "settings" ? "is-active" : undefined}>
            Settings
          </Link>
        </nav>

        <div className="admin-dash-sidebar-bottom">
          <div className="admin-dash-usage">
            <p>AI Usage</p>
            <div>
              <span />
            </div>
            <small>650 / 1,000 queries used</small>
          </div>
          <form action={logoutAction}>
            <button type="submit">Log Out ({session.username})</button>
          </form>
        </div>
      </aside>

      <main
        className={
          view === "write"
            ? "admin-dash-main is-editor"
            : view === "qa"
              ? "admin-dash-main is-assistant"
              : "admin-dash-main"
        }
      >
        {view === "write" ? (
          <AdminEditor username={session.username} embedded />
        ) : view === "qa" ? (
          <QaAssistant />
        ) : (
          <>
            <header className="admin-dash-header">
              <div>
                <p>
                  <span>Admin</span>
                  <span>&gt;</span>
                  <span>{viewLabel(view)}</span>
                </p>
                <h2>
                  {view === "list"
                    ? "Content Management"
                    : view === "ainews"
                      ? "AI News Records"
                      : "Workspace Settings"}
                </h2>
              </div>
              <div className="admin-dash-userbox">
                <button type="button">N</button>
                <span>{session.username.slice(0, 1).toUpperCase()}</span>
              </div>
            </header>

            {view === "list" ? (
              <>
                <section className="admin-dash-controls">
                  <div className="admin-dash-search">
                    <span>S</span>
                    <input placeholder="Search posts by title or category..." type="text" />
                  </div>
                  <div className="admin-dash-actions">
                    <button type="button">Filter</button>
                    <Link href="/admin?view=write">Create New Post</Link>
                  </div>
                </section>

                <section className="admin-dash-table-shell">
                  <table className="admin-dash-table">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Category</th>
                        <th>Date Published</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {articleRows.length > 0 ? (
                        articleRows.map((article) => (
                          <tr key={article.id}>
                            <td>
                              <div className="admin-dash-title-cell">
                                <img src={imageForSeed(article.slug)} alt={article.title} />
                                <span>{article.title}</span>
                              </div>
                            </td>
                            <td>
                              <span className={`admin-dash-category ${categoryToneClass(article.category)}`}>
                                {article.category}
                              </span>
                            </td>
                            <td>{formatDate(article.publishedAt)}</td>
                            <td>
                              <span
                                className={article.published ? "admin-dash-status is-on" : "admin-dash-status"}
                              >
                                {article.published ? "Published" : "Draft"}
                              </span>
                            </td>
                            <td>
                              <div className="admin-dash-row-actions">
                                {article.published ? (
                                  <Link href={`/blog/${article.slug}`}>View</Link>
                                ) : (
                                  <span>View</span>
                                )}
                                <button type="button">Delete</button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="admin-dash-empty">
                            No posts yet. Create your first post.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  <div className="admin-dash-pagination">
                    <p>
                      Showing <strong>{articleShownStart}</strong> to{" "}
                      <strong>{articleShownEnd}</strong> of <strong>{articleTotalCount}</strong> results
                    </p>
                    <div>
                      {articlePage > 1 ? (
                        <Link href={buildArticleListHref(articlePage - 1)}>{"<"}</Link>
                      ) : (
                        <span className="is-disabled">{"<"}</span>
                      )}
                      {articlePageNumbers.map((page) =>
                        page > 0 ? (
                          <Link
                            key={page}
                            href={buildArticleListHref(page)}
                            className={page === articlePage ? "is-active" : undefined}
                          >
                            {page}
                          </Link>
                        ) : (
                          <span key={`ellipsis-${page}`} className="is-disabled">
                            ...
                          </span>
                        )
                      )}
                      {articlePage < articleTotalPages ? (
                        <Link href={buildArticleListHref(articlePage + 1)}>{">"}</Link>
                      ) : (
                        <span className="is-disabled">{">"}</span>
                      )}
                    </div>
                  </div>
                </section>

                <section className="admin-dash-stats">
                  <article>
                    <p>Total Page Views</p>
                    <h3>{totalPageViews.toLocaleString("en-US")}</h3>
                    <span>+12% from last month</span>
                  </article>
                  <article>
                    <p>Active Comments</p>
                    <h3>{activeComments.toLocaleString("en-US")}</h3>
                    <span>Requires moderation: {Math.max(1, draftCount + 2)}</span>
                  </article>
                  <article>
                    <p>AI Tokens Left</p>
                    <h3>4.2M</h3>
                    <span>Resets in 8 days</span>
                  </article>
                </section>
              </>
            ) : view === "ainews" ? (
              <>
                <section className="admin-dash-table-shell">
                  <table className="admin-dash-table">
                    <thead>
                      <tr>
                        <th>Title</th>
                        <th>Source</th>
                        <th>Category</th>
                        <th>News Date</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aiNewsRows.length > 0 ? (
                        aiNewsRows.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <div className="admin-dash-title-cell">
                                <img src={imageForSeed(`${item.source}-${item.id}`)} alt={item.title} />
                                <span>{item.title}</span>
                              </div>
                            </td>
                            <td>{item.source}</td>
                            <td>
                              <span
                                className={`admin-dash-category ${aiNewsCategoryToneClass(item.category)}`}
                              >
                                {aiNewsCategoryLabel(item.category)}
                              </span>
                            </td>
                            <td>{formatDate(item.newsDate)}</td>
                            <td>
                              <span className={item.canPublish ? "admin-dash-status is-on" : "admin-dash-status"}>
                                {item.canPublish ? "Ready" : "Review"}
                              </span>
                            </td>
                            <td>
                              <div className="admin-dash-row-actions">
                                <Link href={buildAiNewsHref(aiNewsPage, item.id)}>View</Link>
                                <a href={item.url} target="_blank" rel="noreferrer">
                                  Source
                                </a>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="admin-dash-empty">
                            No AI news records found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  <div className="admin-dash-pagination">
                    <p>
                      Showing <strong>{aiNewsShownStart}</strong> to{" "}
                      <strong>{aiNewsShownEnd}</strong> of <strong>{aiNewsTotalCount}</strong> results
                    </p>
                    <div>
                      {aiNewsPage > 1 ? (
                        <Link href={buildAiNewsHref(aiNewsPage - 1)}>{"<"}</Link>
                      ) : (
                        <span className="is-disabled">{"<"}</span>
                      )}
                      {aiNewsPageNumbers.map((pageNumber, index) =>
                        pageNumber < 0 ? (
                          <span key={`ellipsis-${index}`} className="is-disabled">
                            ...
                          </span>
                        ) : (
                          <Link
                            key={pageNumber}
                            href={buildAiNewsHref(pageNumber)}
                            className={pageNumber === aiNewsPage ? "is-active" : undefined}
                          >
                            {pageNumber}
                          </Link>
                        ),
                      )}
                      {aiNewsPage < aiNewsTotalPages ? (
                        <Link href={buildAiNewsHref(aiNewsPage + 1)}>{">"}</Link>
                      ) : (
                        <span className="is-disabled">{">"}</span>
                      )}
                    </div>
                  </div>
                </section>

                {selectedNews ? (
                  <section className="admin-ainews-modal" role="dialog" aria-modal="true">
                    <Link
                      href={buildAiNewsHref(aiNewsPage)}
                      className="admin-ainews-modal-backdrop"
                      aria-label="Close preview"
                    />
                    <article className="admin-ainews-detail admin-ainews-detail-modal">
                      <header className="admin-ainews-detail-head">
                        <div>
                          <h3>{selectedNews.title}</h3>
                          <p>ID #{selectedNews.id}</p>
                        </div>
                        <div>
                          <Link href={buildAiNewsHref(aiNewsPage)}>Close</Link>
                          <a href={selectedNews.url} target="_blank" rel="noreferrer">
                            Open Source
                          </a>
                        </div>
                      </header>

                      <p className="admin-ainews-summary">
                        {selectedNews.summary?.trim() || "No summary available."}
                      </p>

                      <dl className="admin-ainews-meta">
                        <div>
                          <dt>Source</dt>
                          <dd>{selectedNews.source}</dd>
                        </div>
                        <div>
                          <dt>Category</dt>
                          <dd>{aiNewsCategoryLabel(selectedNews.category)}</dd>
                        </div>
                        <div>
                          <dt>News Date</dt>
                          <dd>{formatDate(selectedNews.newsDate)}</dd>
                        </div>
                        <div>
                          <dt>Fetched At</dt>
                          <dd>{formatDateTime(selectedNews.fetchedAt)}</dd>
                        </div>
                        <div>
                          <dt>Can Publish</dt>
                          <dd>{selectedNews.canPublish ? "Yes" : "No"}</dd>
                        </div>
                        <div>
                          <dt>Stars</dt>
                          <dd>{selectedNews.stars ?? "-"}</dd>
                        </div>
                        <div>
                          <dt>Language</dt>
                          <dd>{selectedNews.language ?? "-"}</dd>
                        </div>
                        <div>
                          <dt>External ID</dt>
                          <dd>{selectedNews.externalId ?? "-"}</dd>
                        </div>
                        <div>
                          <dt>Tags</dt>
                          <dd>{formatTags(selectedNews.tags)}</dd>
                        </div>
                      </dl>

                      <div className="admin-ainews-raw">
                        <h4>Raw Payload</h4>
                        <pre>{formatJson(selectedNews.raw)}</pre>
                      </div>
                    </article>
                  </section>
                ) : selectedNewsId != null ? (
                  <section className="admin-dash-placeholder">
                    <article>
                      <h3>Record Not Found</h3>
                      <p>The selected AI news item does not exist or has been removed.</p>
                      <Link href={buildAiNewsHref(aiNewsPage)}>Back to AI news list</Link>
                    </article>
                  </section>
                ) : null}
              </>
            ) : (
              <section className="admin-dash-placeholder">
                <article>
                  <h3>Settings</h3>
                  <p>
                    Manage profile, publishing, and storage options here. This panel now opens in-place on
                    the right without switching pages.
                  </p>
                  <Link href="/admin?view=list">Back to blog list</Link>
                </article>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
