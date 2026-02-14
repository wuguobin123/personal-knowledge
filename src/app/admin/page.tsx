import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import AdminEditor from "./admin-editor";
import { ADMIN_SESSION_COOKIE, getAdminSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ view?: string }>;
};

type AdminView = "list" | "write" | "qa" | "settings";

type ArticleRow = {
  id: number;
  title: string;
  slug: string;
  category: string;
  publishedAt: Date;
  published: boolean;
};

const TABLE_IMAGES = [
  "https://images.unsplash.com/photo-1677442135703-1787eea5ce01?auto=format&fit=crop&w=400&q=80",
  "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=400&q=80",
  "https://images.unsplash.com/photo-1518773553398-650c184e0bb3?auto=format&fit=crop&w=400&q=80",
  "https://images.unsplash.com/photo-1461749280684-dccba630e2f6?auto=format&fit=crop&w=400&q=80",
  "https://images.unsplash.com/photo-1517430816045-df4b7de11d1d?auto=format&fit=crop&w=400&q=80",
];

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

function normalizeView(view?: string): AdminView {
  if (view === "write" || view === "qa" || view === "settings" || view === "list") {
    return view;
  }
  return "list";
}

function viewLabel(view: AdminView) {
  if (view === "write") return "Write Post";
  if (view === "qa") return "Q&A Assistant";
  if (view === "settings") return "Settings";
  return "Blog List";
}

async function logoutAction() {
  "use server";
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
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

  const { view: viewParam } = await searchParams;
  const view = normalizeView(viewParam);

  let articles: ArticleRow[] = [];
  let totalCount = 0;
  let publishedCount = 0;

  if (view === "list") {
    [articles, totalCount, publishedCount] = await Promise.all([
      prisma.article.findMany({
        orderBy: { publishedAt: "desc" },
        select: {
          id: true,
          title: true,
          slug: true,
          category: true,
          publishedAt: true,
          published: true,
        },
      }),
      prisma.article.count(),
      prisma.article.count({ where: { published: true } }),
    ]);
  }

  const pageSize = 4;
  const rows = articles.slice(0, pageSize);
  const shownEnd = Math.min(pageSize, totalCount);
  const draftCount = Math.max(0, totalCount - publishedCount);
  const totalPageViews = totalCount * 3121 + 7000;
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
          <section className="admin-assistant-page">
            <header className="admin-assistant-topbar">
              <div className="admin-assistant-topic">
                <h2>SEO Strategy for Nov Post</h2>
                <span />
                <div className="admin-assistant-mode-switch">
                  <button type="button" className="is-active">
                    Blog Context
                  </button>
                  <button type="button">Web Search</button>
                </div>
              </div>
              <div className="admin-assistant-top-actions">
                <button type="button">Share</button>
                <button type="button" aria-label="More actions">
                  ...
                </button>
              </div>
            </header>

            <div className="admin-assistant-feed">
              <article className="admin-assistant-row">
                <div className="admin-assistant-avatar is-ai">AI</div>
                <div className="admin-assistant-bubble is-ai">
                  <p>
                    Hello! I&apos;ve analyzed your upcoming blog post &quot;Mastering Digital Workflows&quot;.
                    Based on your previous content, here are some SEO suggestions:
                  </p>
                  <ul>
                    <li>
                      Target Keyword: <strong>&quot;productivity automation tools&quot;</strong>
                    </li>
                    <li>Include 3 internal links to your &quot;Time Management&quot; series.</li>
                    <li>Add an alt-tag for the main diagram about workflow loops.</li>
                  </ul>
                </div>
              </article>

              <div className="admin-assistant-actions">
                <button type="button">Like</button>
                <button type="button">Dislike</button>
                <button type="button">Copy</button>
              </div>

              <article className="admin-assistant-row is-user">
                <div className="admin-assistant-avatar is-user">U</div>
                <div className="admin-assistant-message">
                  <div className="admin-assistant-bubble is-user">
                    That sounds great. Can you write a 150-word meta description that includes the target
                    keyword and has a professional but engaging tone?
                  </div>
                  <p>Sent 12:45 PM</p>
                </div>
              </article>

              <article className="admin-assistant-row">
                <div className="admin-assistant-avatar is-ai">AI</div>
                <div className="admin-assistant-bubble is-ai">
                  <p>Certainly! Here&apos;s a meta description optimized for your blog:</p>
                  <pre>
                    <code>
                      {'<meta name="description" content="Discover the best productivity automation tools to streamline your digital workflow. Learn how to eliminate repetitive tasks and focus on what matters most with our comprehensive guide for modern professionals.">'}
                    </code>
                  </pre>
                  <p>I&apos;ve also drafted a slightly longer version if you need more character space.</p>
                </div>
              </article>
            </div>

            <footer className="admin-assistant-compose">
              <div className="admin-assistant-compose-box">
                <textarea rows={3} placeholder="Type your message here..." />
                <div className="admin-assistant-compose-row">
                  <div className="admin-assistant-compose-tools">
                    <button type="button" aria-label="Attach file">
                      Attach
                    </button>
                    <button type="button" aria-label="Add image">
                      Image
                    </button>
                    <button type="button" aria-label="Use web search">
                      Web
                    </button>
                  </div>
                  <div className="admin-assistant-compose-send">
                    <span>Enter to send / Shift + Enter for new line</span>
                    <button type="button">Send</button>
                  </div>
                </div>
              </div>
              <div className="admin-assistant-shortcuts">
                <button type="button">Summarize Blog Post</button>
                <button type="button">Check Grammar</button>
                <button type="button">Find References</button>
              </div>
            </footer>
          </section>
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
                  {view === "list" ? "Content Management" : "Workspace Settings"}
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
                      {rows.length > 0 ? (
                        rows.map((article) => (
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
                      Showing <strong>{totalCount > 0 ? 1 : 0}</strong> to <strong>{shownEnd}</strong> of{" "}
                      <strong>{totalCount}</strong> results
                    </p>
                    <div>
                      <button type="button" disabled>
                        {"<"}
                      </button>
                      <button type="button" className="is-active">
                        1
                      </button>
                      <button type="button">2</button>
                      <button type="button">3</button>
                      <button type="button">{">"}</button>
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
