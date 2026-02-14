import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const COVER_IMAGES = [
  "https://images.unsplash.com/photo-1484417894907-623942c8ee29?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1486946255434-2466348c2166?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1200&q=80",
];

const NEWS_ITEMS = [
  {
    source: "TECHCRUNCH",
    time: "5m ago",
    title: "Major breakthroughs in solid-state battery technology announced today.",
  },
  {
    source: "REUTERS",
    time: "14m ago",
    title: "Global markets respond to unexpected shifts in renewable energy policy.",
  },
  {
    source: "VERGE",
    time: "1h ago",
    title: "Apple's latest software update aims to redefine privacy on the web.",
  },
  {
    source: "BLOOMBERG",
    time: "2h ago",
    title: "Remote work trends showing a second wave of urban-to-rural migration.",
  },
];

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function sourceTypeLabel(sourceType: "ORIGINAL" | "CRAWLER" | "TRANSCRIPT") {
  if (sourceType === "CRAWLER") {
    return "爬虫采集";
  }
  if (sourceType === "TRANSCRIPT") {
    return "转录总结";
  }
  return "原创";
}

function tagsFromJson(tags: unknown) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function estimateReadTime(content: string) {
  const plainText = content.replace(/[#*_`>\-[\]()!]/g, " ");
  const chineseChars = (plainText.match(/[\u4e00-\u9fa5]/g) || []).length;
  const latinWords = plainText
    .replace(/[\u4e00-\u9fa5]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  const totalWordCount = chineseChars + latinWords;
  const minutes = Math.max(3, Math.round(totalWordCount / 220));
  return `${minutes} min read`;
}

function pickCover(index: number) {
  return COVER_IMAGES[index % COVER_IMAGES.length];
}

export default async function Home() {
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
      content: true,
      publishedAt: true,
    },
  });

  const [featuredArticle, ...restArticles] = articles;
  const regularArticles = restArticles.slice(0, 2);
  const moreArticleCount = Math.max(0, restArticles.length - regularArticles.length);
  const categories = Array.from(
    new Set(
      articles
        .map((article) => article.category?.trim())
        .filter((category): category is string => Boolean(category))
    )
  ).slice(0, 6);
  const tags = Array.from(new Set(articles.flatMap((article) => tagsFromJson(article.tags)))).slice(
    0,
    8
  );
  const currentYear = new Date().getFullYear();

  return (
    <div className="home-page">
      <header className="home-header">
        <div className="home-header-inner">
          <div className="home-brand-row">
            <Link className="home-brand" href="/">
              <span className="home-brand-icon">B</span>
              <span className="home-brand-name">BluePrint.</span>
            </Link>
            <nav className="home-nav" aria-label="主导航">
              <Link className="is-active" href="/">
                Home
              </Link>
              <a href="#">Archive</a>
              <a href="#">About</a>
            </nav>
          </div>
          <div className="home-header-actions">
            <button className="home-search-btn" type="button" aria-label="搜索">
              <span>⌕</span>
            </button>
            <Link className="home-admin-link" href="/admin">
              Admin Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="home-main">
        <div className="home-grid">
          <section className="home-feed">
            {featuredArticle ? (
              <>
                <article className="home-feature">
                  <Link className="home-feature-cover" href={`/blog/${featuredArticle.slug}`}>
                    <img
                      src={pickCover(0)}
                      alt={featuredArticle.title}
                      loading="eager"
                      decoding="async"
                    />
                    <div className="home-feature-overlay" />
                    <div className="home-feature-pill-row">
                      <span>{featuredArticle.category}</span>
                      <span>{estimateReadTime(featuredArticle.content)}</span>
                    </div>
                  </Link>
                  <h1>
                    <Link href={`/blog/${featuredArticle.slug}`}>{featuredArticle.title}</Link>
                  </h1>
                  <p>{featuredArticle.excerpt}</p>
                  <div className="home-feature-meta">
                    <span className="home-author-badge">W</span>
                    <span>Wuxiaomu</span>
                    <span className="home-meta-dot">•</span>
                    <span>{formatDate(featuredArticle.publishedAt)}</span>
                    <span className="home-meta-dot">•</span>
                    <span>{sourceTypeLabel(featuredArticle.sourceType)}</span>
                  </div>
                  {featuredArticle.sourceDetail ? (
                    <p className="home-source">Source: {featuredArticle.sourceDetail}</p>
                  ) : null}
                </article>

                <hr className="home-divider" />

                <div className="home-post-grid">
                  {regularArticles.map((article, index) => (
                    <article
                      key={article.id}
                      className="home-post-card"
                      style={{ animationDelay: `${120 * (index + 1)}ms` }}
                    >
                      <Link className="home-post-cover" href={`/blog/${article.slug}`}>
                        <img
                          src={pickCover(index + 1)}
                          alt={article.title}
                          loading="lazy"
                          decoding="async"
                        />
                      </Link>
                      <span className="home-post-category">{article.category}</span>
                      <h2>
                        <Link href={`/blog/${article.slug}`}>{article.title}</Link>
                      </h2>
                      <p>{article.excerpt}</p>
                      <div className="home-post-meta">
                        <span>{estimateReadTime(article.content)}</span>
                        <span className="home-meta-dot">•</span>
                        <span>{formatDate(article.publishedAt)}</span>
                      </div>
                    </article>
                  ))}
                </div>

                {moreArticleCount > 0 ? (
                  <div className="home-more-wrap">
                    <button className="home-load-more" type="button">
                      Load More Articles ({moreArticleCount})
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="home-empty">
                <h1>Welcome to BluePrint</h1>
                <p>当前还没有可展示的文章，先去后台发布一篇内容吧。</p>
                <Link href="/admin">进入后台发布</Link>
              </div>
            )}
          </section>

          <aside className="home-sidebar">
            <section className="home-widget home-profile">
              <div className="home-profile-header">
                <span className="home-avatar">W</span>
                <div>
                  <h3>Wuxiaomu</h3>
                  <p>Software Engineer & Writer</p>
                </div>
              </div>
              <p>
                Exploring the intersection of technology, design and philosophy. I build tools for
                thought and share my journey here.
              </p>
              <div className="home-profile-links">
                <a href="#" aria-label="RSS 订阅">
                  RSS
                </a>
                <a href="#" aria-label="终端主页">
                  DEV
                </a>
                <a href="#" aria-label="邮件联系">
                  @
                </a>
              </div>
            </section>

            <section className="home-widget home-news">
              <div className="home-widget-title-row">
                <h3>Daily Hot News</h3>
                <span>LIVE</span>
              </div>
              <div className="home-news-list">
                {NEWS_ITEMS.map((item) => (
                  <article key={item.title} className="home-news-item">
                    <div className="home-news-meta">
                      <span>{item.source}</span>
                      <span>{item.time}</span>
                    </div>
                    <h4>{item.title}</h4>
                  </article>
                ))}
              </div>
              <a className="home-news-link" href="#">
                VIEW ALL NEWS
              </a>
            </section>

            <section className="home-widget home-categories">
              <h3>Categories</h3>
              <div className="home-tag-list">
                {(categories.length > 0 ? categories : ["技术写作", "AI", "部署", "React", "Notes"]).map(
                  (category) => (
                    <span key={category}>{category}</span>
                  )
                )}
                {tags.slice(0, 4).map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </main>

      <footer className="home-footer">
        <div className="home-footer-inner">
          <div>
            <p className="home-footer-brand">BluePrint Blog</p>
            <p className="home-footer-copy">© {currentYear} Wuxiaomu. All rights reserved.</p>
          </div>
          <nav>
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Service</a>
            <a href="#">Contact</a>
          </nav>
        </div>
      </footer>

      <Link className="home-fab" href="/admin" aria-label="进入后台管理">
        ✦
      </Link>
    </div>
  );
}
