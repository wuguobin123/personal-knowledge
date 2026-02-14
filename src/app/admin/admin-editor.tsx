"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import MarkdownRenderer from "@/components/markdown-renderer";

type PublishResult = {
  id: number;
  title: string;
  slug: string;
};

type AdminEditorProps = {
  username?: string;
  embedded?: boolean;
};

type SubmitMode = "draft" | "publish" | null;

const LOCAL_DRAFT_KEY = "admin-write-draft-v3";

type DraftState = {
  articleId: number | null;
  title: string;
  slug: string;
  category: string;
  tags: string[];
  content: string;
  heroImageUrl: string;
};

const DEFAULT_DRAFT: DraftState = {
  articleId: null,
  title: "",
  slug: "",
  category: "Technology",
  tags: ["AI", "Future"],
  content: "",
  heroImageUrl: "",
};

const RELATED_NEWS = [
  {
    title: "OpenAI releases GPT-5 preview features...",
    source: "TechCrunch - 2h ago",
  },
  {
    title: "The future of headless CMS in 2024",
    source: "Smashing Magazine - 5h ago",
  },
  {
    title: "Apple's new accessibility features revealed",
    source: "The Verge - 1d ago",
  },
];

function toSlug(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function nowTimeLabel() {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function clampExcerpt(content: string) {
  const plain = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[>#*_!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (plain || "Draft article excerpt").slice(0, 280);
}

function normalizeSelectionText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export default function AdminEditor({ username = "admin", embedded = false }: AdminEditorProps) {
  const router = useRouter();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const heroInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(DEFAULT_DRAFT.title);
  const [articleId, setArticleId] = useState<number | null>(DEFAULT_DRAFT.articleId);
  const [slug, setSlug] = useState(DEFAULT_DRAFT.slug);
  const [slugTouched, setSlugTouched] = useState(false);
  const [category, setCategory] = useState(DEFAULT_DRAFT.category);
  const [tags, setTags] = useState<string[]>(DEFAULT_DRAFT.tags);
  const [tagInput, setTagInput] = useState("");
  const [content, setContent] = useState(DEFAULT_DRAFT.content);
  const [heroImageUrl, setHeroImageUrl] = useState(DEFAULT_DRAFT.heroImageUrl);
  const [schedulePost, setSchedulePost] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [assistOpen, setAssistOpen] = useState(false);
  const [savedAt, setSavedAt] = useState("14:23");
  const [submittingMode, setSubmittingMode] = useState<SubmitMode>(null);
  const [uploadingHero, setUploadingHero] = useState(false);
  const [uploadingInline, setUploadingInline] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PublishResult | null>(null);
  const [newsItems, setNewsItems] = useState(RELATED_NEWS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOCAL_DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as DraftState;
      if (typeof parsed.articleId === "number") setArticleId(parsed.articleId);
      if (parsed.title) setTitle(parsed.title);
      if (parsed.slug) {
        setSlug(parsed.slug);
        setSlugTouched(true);
      }
      if (parsed.category) setCategory(parsed.category);
      if (Array.isArray(parsed.tags)) setTags(parsed.tags.filter(Boolean).slice(0, 12));
      if (parsed.content) setContent(parsed.content);
      if (parsed.heroImageUrl) setHeroImageUrl(parsed.heroImageUrl);
    } catch {
      localStorage.removeItem(LOCAL_DRAFT_KEY);
    }
  }, []);

  useEffect(() => {
    if (slugTouched) return;
    setSlug(toSlug(title));
  }, [title, slugTouched]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const draft: DraftState = { articleId, title, slug, category, tags, content, heroImageUrl };
      localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(draft));
      setSavedAt(nowTimeLabel());
    }, 600);
    return () => window.clearTimeout(timer);
  }, [articleId, title, slug, category, tags, content, heroImageUrl]);

  function focusEditorAt(start: number, end: number) {
    requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      editor.setSelectionRange(start, end);
    });
  }

  function replaceSelection(
    transformer: (selected: string) => { replacement: string; selectedStartOffset?: number; selectedEndOffset?: number }
  ) {
    const editor = editorRef.current;
    if (!editor) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = content.slice(start, end);
    const { replacement, selectedStartOffset, selectedEndOffset } = transformer(selected);
    const next = `${content.slice(0, start)}${replacement}${content.slice(end)}`;
    setContent(next);
    const nextStart = start + (selectedStartOffset ?? replacement.length);
    const nextEnd = start + (selectedEndOffset ?? replacement.length);
    focusEditorAt(nextStart, nextEnd);
  }

  function wrapSelection(prefix: string, suffix: string, fallback = "text") {
    replaceSelection((selected) => {
      const value = selected || fallback;
      const replacement = `${prefix}${value}${suffix}`;
      return {
        replacement,
        selectedStartOffset: prefix.length,
        selectedEndOffset: prefix.length + value.length,
      };
    });
  }

  function prefixSelectedLines(prefix: string) {
    replaceSelection((selected) => {
      const value = selected || "item";
      const replacement = value
        .split("\n")
        .map((line) => `${prefix}${line}`)
        .join("\n");
      return { replacement };
    });
  }

  function processSelectedText(mode: "polish" | "shorten" | "expand" | "uppercase" | "bullets") {
    replaceSelection((selected) => {
      const base = normalizeSelectionText(selected || "");
      if (!base) return { replacement: selected || "" };

      if (mode === "polish") {
        const polished = `${base.charAt(0).toUpperCase()}${base.slice(1)}`.replace(/\s+,/g, ",");
        return { replacement: /[.!?]$/.test(polished) ? polished : `${polished}.` };
      }
      if (mode === "shorten") {
        return { replacement: base.length > 90 ? `${base.slice(0, 87)}...` : base };
      }
      if (mode === "expand") {
        return {
          replacement: `${base} This perspective can be extended with practical examples and clear implementation steps.`,
        };
      }
      if (mode === "uppercase") {
        return { replacement: base.toUpperCase() };
      }
      const bullets = base
        .split(/[.!?]\s+/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => `- ${item}`)
        .join("\n");
      return { replacement: bullets || `- ${base}` };
    });
    setAssistOpen(false);
  }

  function addTag() {
    const next = tagInput.trim();
    if (!next) return;
    if (tags.includes(next)) {
      setTagInput("");
      return;
    }
    setTags((prev) => [...prev, next].slice(0, 12));
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((item) => item !== tag));
  }

  async function uploadImage(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/api/admin/upload", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Upload failed");
    }
    return String(data.url || "");
  }

  async function handleHeroFile(file: File) {
    setUploadingHero(true);
    setError("");
    try {
      const url = await uploadImage(file);
      setHeroImageUrl(url);
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Upload failed";
      setError(message);
    } finally {
      setUploadingHero(false);
    }
  }

  async function handleInlineImage(file: File) {
    setUploadingInline(true);
    setError("");
    try {
      const url = await uploadImage(file);
      replaceSelection(() => ({
        replacement: `\n\n![${file.name}](${url})\n\n`,
      }));
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Upload failed";
      setError(message);
    } finally {
      setUploadingInline(false);
    }
  }

  async function submitArticle(mode: SubmitMode) {
    if (!mode) return;
    setSubmittingMode(mode);
    setError("");
    setResult(null);

    const normalizedTitle = title.trim();
    const normalizedContent = content.trim();
    if (!normalizedTitle || !normalizedContent) {
      setError("Title and content are required.");
      setSubmittingMode(null);
      return;
    }

    const body = {
      id: articleId,
      title: normalizedTitle,
      slug: slug.trim() || toSlug(normalizedTitle),
      category,
      tags,
      sourceType: "ORIGINAL",
      sourceDetail: "",
      excerpt: clampExcerpt(normalizedContent),
      content: normalizedContent,
      published: mode === "publish",
    };

    try {
      const response = await fetch("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Submit failed");
      }

      setResult(data);
      setArticleId(typeof data.id === "number" ? data.id : articleId);
      setSavedAt(nowTimeLabel());
      if (mode === "publish") {
        localStorage.removeItem(LOCAL_DRAFT_KEY);
        router.push(`/blog/${data.slug}`);
        return;
      }
      router.refresh();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Submit failed";
      setError(message);
    } finally {
      setSubmittingMode(null);
    }
  }

  function handleEditorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitArticle("publish");
  }

  function refreshNews() {
    setNewsItems((prev) => {
      const next = [...prev];
      next.push(next.shift() || next[0]);
      return next;
    });
  }

  const previewTitle = title.trim() || "New Blog Post";
  const previewSlug = slug.trim() || "new-blog-post";
  const previewDescription = clampExcerpt(content || "Start writing your masterpiece here...");
  const previewMarkdown = useMemo(() => {
    if (!content.trim()) return "## Start writing your masterpiece here...";
    return content;
  }, [content]);

  return (
    <div className={`admin-write-page${embedded ? " is-embedded" : ""}`}>
      <header className="admin-write-topbar">
        <div className="admin-write-top-left">
          {!embedded ? (
            <Link href="/admin" className="admin-write-back">
              Back
            </Link>
          ) : null}
          <div className="admin-write-head-meta">
            <span>Draft</span>
            <strong>{previewTitle}</strong>
          </div>
        </div>
        <div className="admin-write-top-right">
          <span>
            Saved at {savedAt} as {username}
          </span>
          <button type="button" onClick={() => setPreviewOpen(true)}>
            Preview
          </button>
          <button type="button" onClick={() => void submitArticle("draft")} disabled={submittingMode !== null}>
            {submittingMode === "draft" ? "Saving..." : "Save Draft"}
          </button>
          <button type="button" onClick={() => void submitArticle("publish")} disabled={submittingMode !== null}>
            {submittingMode === "publish" ? "Publishing..." : "Publish"}
          </button>
        </div>
      </header>

      <form className="admin-write-layout" onSubmit={handleEditorSubmit}>
        <section className="admin-write-main">
          <button
            className="admin-write-hero"
            type="button"
            onClick={() => heroInputRef.current?.click()}
            disabled={uploadingHero}
          >
            {heroImageUrl ? <img src={heroImageUrl} alt="Featured" /> : null}
            <div className="admin-write-hero-overlay">
              <p>{uploadingHero ? "Uploading image..." : "Upload Featured Image"}</p>
              <small>Recommended size: 1200x630px</small>
            </div>
          </button>
          <input
            ref={heroInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleHeroFile(file);
              event.currentTarget.value = "";
            }}
          />

          <textarea
            className="admin-write-title"
            placeholder="Enter your story title..."
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            rows={1}
            onInput={(event) => {
              const node = event.currentTarget;
              node.style.height = "auto";
              node.style.height = `${node.scrollHeight}px`;
            }}
          />

          <div className="admin-write-toolbar">
            <button type="button" onClick={() => wrapSelection("**", "**", "bold text")}>
              B
            </button>
            <button type="button" onClick={() => wrapSelection("*", "*", "italic text")}>
              I
            </button>
            <button type="button" onClick={() => wrapSelection("<u>", "</u>", "underlined text")}>
              U
            </button>
            <span />
            <button type="button" onClick={() => prefixSelectedLines("## ")}>
              T
            </button>
            <button type="button" onClick={() => prefixSelectedLines("> ")}>
              "
            </button>
            <button type="button" onClick={() => wrapSelection("[", "](https://example.com)", "link text")}>
              Link
            </button>
            <button type="button" onClick={() => imageInputRef.current?.click()} disabled={uploadingInline}>
              {uploadingInline ? "..." : "Image"}
            </button>
            <button type="button" onClick={() => prefixSelectedLines("- ")}>
              List
            </button>
            <button type="button" onClick={() => wrapSelection("`", "`", "code")}>
              Code
            </button>
            <div className="admin-write-toolbar-spacer" />
            <div className="admin-write-assist-wrap">
              <button type="button" onClick={() => setAssistOpen((prev) => !prev)}>
                AI Assist
              </button>
              {assistOpen ? (
                <div className="admin-write-assist-menu">
                  <button type="button" onClick={() => processSelectedText("polish")}>
                    Polish selected text
                  </button>
                  <button type="button" onClick={() => processSelectedText("shorten")}>
                    Shorten selected text
                  </button>
                  <button type="button" onClick={() => processSelectedText("expand")}>
                    Expand selected text
                  </button>
                  <button type="button" onClick={() => processSelectedText("uppercase")}>
                    Uppercase selected text
                  </button>
                  <button type="button" onClick={() => processSelectedText("bullets")}>
                    Convert selection to bullets
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <textarea
            ref={editorRef}
            className="admin-write-editor"
            placeholder="Start writing your masterpiece here..."
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleInlineImage(file);
              event.currentTarget.value = "";
            }}
          />
        </section>

        <aside className="admin-write-sidebar">
          <section>
            <h3>Post Settings</h3>
            <label htmlFor="category">Category</label>
            <select id="category" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option>Technology</option>
              <option>Design</option>
              <option>Productivity</option>
              <option>Lifestyle</option>
            </select>

            <label htmlFor="tag-input">Tags</label>
            <div className="admin-write-tags">
              {tags.map((tag) => (
                <span key={tag}>
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)}>
                    x
                  </button>
                </span>
              ))}
            </div>
            <input
              id="tag-input"
              type="text"
              placeholder="Add tag..."
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  addTag();
                }
              }}
              onBlur={addTag}
            />
          </section>

          <section className="admin-write-news">
            <div>
              <h4>Related News</h4>
              <span>AI</span>
            </div>
            <div className="admin-write-news-list">
              {newsItems.map((item) => (
                <article key={item.title}>
                  <p>{item.title}</p>
                  <small>{item.source}</small>
                </article>
              ))}
            </div>
            <button type="button" onClick={refreshNews}>
              Refresh News Feed
            </button>
          </section>

          <section>
            <h3>Search Preview</h3>
            <div className="admin-write-search-preview">
              <p>yoursite.com/blog/{previewSlug}</p>
              <p>{previewTitle} - Admin Dashboard</p>
              <p>{previewDescription}</p>
            </div>

            <label htmlFor="slug">Slug</label>
            <input
              id="slug"
              type="text"
              value={slug}
              onChange={(event) => {
                setSlugTouched(true);
                setSlug(toSlug(event.target.value));
              }}
            />

            <label className="admin-write-schedule" htmlFor="schedule-post">
              <input
                id="schedule-post"
                type="checkbox"
                checked={schedulePost}
                onChange={(event) => setSchedulePost(event.target.checked)}
              />
              <span>Schedule post</span>
            </label>
          </section>
        </aside>

        {error ? <div className="admin-write-error">{error}</div> : null}
        {result ? (
          <div className="admin-write-success">
            Saved: <Link href={`/blog/${result.slug}`}>{result.title}</Link>
          </div>
        ) : null}
      </form>

      {previewOpen ? (
        <div className="admin-write-preview-modal">
          <div className="admin-write-preview-card">
            <div className="admin-write-preview-head">
              <h3>Preview</h3>
              <button type="button" onClick={() => setPreviewOpen(false)}>
                Close
              </button>
            </div>
            <div className="admin-write-preview-content">
              {heroImageUrl ? <img src={heroImageUrl} alt={previewTitle} /> : null}
              <h1>{previewTitle}</h1>
              <MarkdownRenderer content={previewMarkdown} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
