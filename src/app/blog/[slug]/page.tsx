import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import MarkdownRenderer from "@/components/markdown-renderer";
import ReadingProgress from "@/components/reading-progress";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
};

const HERO_IMAGES = [
  "https://images.unsplash.com/photo-1642425149556-b6f70d5c7046?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1633412802994-5c058f151b66?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1573164574511-73c773193279?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1600&q=80",
];

const RELATED_IMAGES = [
  "https://images.unsplash.com/photo-1486946255434-2466348c2166?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1517430816045-df4b7de11d1d?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1614730321146-b6fa6a46bcb4?auto=format&fit=crop&w=900&q=80",
  "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=900&q=80",
];

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = await prisma.article.findUnique({
    where: { slug },
    select: { title: true, excerpt: true },
  });

  if (!article) {
    return {
      title: "文章不存在",
    };
  }

  return {
    title: article.title,
    description: article.excerpt,
  };
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function sourceTypeLabel(type: "ORIGINAL" | "CRAWLER" | "TRANSCRIPT") {
  if (type === "CRAWLER") return "Crawler";
  if (type === "TRANSCRIPT") return "Transcript";
  return "Original";
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
  const wordCount = chineseChars + latinWords;
  return `${Math.max(3, Math.round(wordCount / 220))} min read`;
}

function pickImage(list: string[], seed: string) {
  const total = seed
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return list[total % list.length];
}

export default async function BlogDetailPage({ params }: Props) {
  const { slug } = await params;
  const article = await prisma.article.findUnique({
    where: { slug },
    select: {
      slug: true,
      title: true,
      excerpt: true,
      content: true,
      category: true,
      tags: true,
      sourceType: true,
      published: true,
      publishedAt: true,
    },
  });

  if (!article || !article.published) {
    notFound();
  }

  const relatedArticles = await prisma.article.findMany({
    where: {
      published: true,
      slug: { not: article.slug },
    },
    orderBy: { publishedAt: "desc" },
    take: 3,
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      category: true,
    },
  });

  const tags = tagsFromJson(article.tags);
  const authorName = "Elena Rodriguez";
  const authorRole = "Design Lead";
  const readTime = estimateReadTime(article.content);
  const heroImage = pickImage(HERO_IMAGES, article.slug);

  return (
    <div className="detail-page">
      <ReadingProgress />

      <nav className="detail-top-nav">
        <div className="detail-top-nav-inner">
          <div className="detail-top-left">
            <Link className="detail-logo" href="/">
              <span>TECHFLOW</span>
            </Link>
            <div className="detail-nav-links">
              <a href="#">News</a>
              <a className="is-active" href="#">
                Articles
              </a>
              <a href="#">Tutorials</a>
              <a href="#">Case Studies</a>
            </div>
          </div>

          <div className="detail-top-right">
            <label className="detail-search">
              <span>S</span>
              <input placeholder="Search articles..." type="text" />
            </label>
            <button className="detail-ai-btn" type="button">
              AI Assistant
            </button>
            <span className="detail-mini-avatar">A</span>
          </div>
        </div>
      </nav>

      <main className="detail-main">
        <header className="detail-header">
          <nav className="detail-breadcrumb">
            <Link href="/">Home</Link>
            <span>{">"}</span>
            <span>{article.category}</span>
            <span>{">"}</span>
            <span>{tags[0] || sourceTypeLabel(article.sourceType)}</span>
          </nav>

          <h1>{article.title}</h1>

          <div className="detail-header-meta">
            <div className="detail-author">
              <span className="detail-author-avatar">E</span>
              <div>
                <p>{authorName}</p>
                <p>
                  {authorRole} - {formatDate(article.publishedAt)}
                </p>
              </div>
            </div>
            <div className="detail-facts">
              <span>{readTime}</span>
              <span>12.4k views</span>
            </div>
          </div>
        </header>

        <aside className="detail-side-actions" aria-label="article actions">
          <button type="button" aria-label="like">
            +
          </button>
          <button type="button" aria-label="bookmark">
            S
          </button>
          <button type="button" aria-label="share">
            Share
          </button>
        </aside>

        <article className="detail-article">
          <figure className="detail-hero-image">
            <img src={heroImage} alt={article.title} loading="eager" decoding="async" />
            <figcaption>
              Generative interfaces are shifting the way we think about interaction design.
            </figcaption>
          </figure>

          <section className="detail-rich-text">
            <p className="detail-lead">{article.excerpt}</p>
            <div className="article-rich">
              <MarkdownRenderer content={article.content} />
            </div>
          </section>

          <section className="detail-ai-summary">
            <div className="detail-ai-summary-icon">*</div>
            <div className="detail-ai-summary-label">AI Summary</div>
            <p>
              This article explores the transformative role of AI in UI design, highlighting{" "}
              <strong>{tags[0] || "Generative UI"}</strong> and{" "}
              <strong>{tags[1] || "Predictive Accessibility"}</strong> as the two main pillars of
              the next decade.
            </p>
            <button type="button">Ask AI more about this article -&gt;</button>
          </section>
        </article>

        <section className="detail-related">
          <div className="detail-section-title">
            <h2>Related Articles</h2>
            <a href="#">View Archive -&gt;</a>
          </div>

          {relatedArticles.length > 0 ? (
            <div className="detail-related-grid">
              {relatedArticles.map((related) => (
                <article key={related.id} className="detail-related-card">
                  <Link href={`/blog/${related.slug}`} className="detail-related-image">
                    <img
                      src={pickImage(RELATED_IMAGES, related.slug)}
                      alt={related.title}
                      loading="lazy"
                      decoding="async"
                    />
                    <span>{related.category}</span>
                  </Link>
                  <h3>
                    <Link href={`/blog/${related.slug}`}>{related.title}</Link>
                  </h3>
                  <p>{related.excerpt}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="detail-related-empty">No related articles yet.</p>
          )}
        </section>

        <section className="detail-newsletter">
          <div>
            <h3>Join the inner circle.</h3>
            <p>Weekly insights on tech, design, and AI delivered straight to your inbox.</p>
          </div>
          <form>
            <input type="email" placeholder="email@example.com" />
            <button type="button">Subscribe</button>
          </form>
        </section>
      </main>

      <footer className="detail-footer">
        <div className="detail-footer-inner">
          <div className="detail-footer-brand">TECHFLOW</div>
          <nav>
            <a href="#">About</a>
            <a href="#">Privacy</a>
            <a href="#">Terms</a>
            <a href="#">Contact</a>
          </nav>
          <div className="detail-footer-socials">
            <a href="#" aria-label="website">
              W
            </a>
            <a href="#" aria-label="camera">
              C
            </a>
            <a href="#" aria-label="mail">
              M
            </a>
          </div>
        </div>
        <p>(c) 2024 TechFlow Media. All rights reserved. Built with passion for designers.</p>
      </footer>
    </div>
  );
}
