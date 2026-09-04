import { useEffect, useRef, useState } from "react";
import { Bold, Image as ImageIcon, Italic, Underline, X } from "lucide-react";

import type { ArticleInput, ArticleRow } from "@/lib/articles";
import { cn } from "@/lib/utils";

const inputClass =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-black";
const blueButton =
  "rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-60";
const toolButton =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors hover:bg-muted";

const COLORS = ["#0f172a", "#2563eb", "#dc2626", "#16a34a", "#d97706"];

/** Full-screen rich writer used to create and edit admin articles. */
export function ArticleEditor({
  article,
  authorName,
  saving,
  onCancel,
  onSave,
}: {
  article: ArticleRow | null;
  authorName: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (input: ArticleInput) => void;
}) {
  const [title, setTitle] = useState(article?.title ?? "");
  const [category, setCategory] = useState(article?.category ?? "");
  const [summary, setSummary] = useState(article?.summary ?? "");
  const [imageUrl, setImageUrl] = useState(article?.image_url ?? "");
  const [author, setAuthor] = useState(article?.author_name ?? authorName);
  const [embedUrl, setEmbedUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.innerHTML = article?.content ?? "";
  }, [article]);

  const exec = (command: string, value?: string) => {
    bodyRef.current?.focus();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, value);
  };

  const insertImage = () => {
    const url = embedUrl.trim();
    if (!url) return;
    exec("insertHTML", `<img src="${url}" alt="" />`);
    setEmbedUrl("");
  };

  const submit = () => {
    const content = bodyRef.current?.innerHTML ?? "";
    if (!title.trim() || !category.trim() || !summary.trim() || !imageUrl.trim() || !content.trim()) {
      setError("Fill in the title, category, summary, header image and article body.");
      return;
    }
    setError(null);
    onSave({
      title: title.trim(),
      category: category.trim(),
      summary: summary.trim(),
      content,
      image_url: imageUrl.trim(),
      author_name: author.trim() || "The League Office",
      published: true,
    });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <header className="mb-6 flex items-center justify-between gap-3">
          <h2 className="display-title text-2xl uppercase tracking-wide">
            {article ? "Edit Article" : "Create New Article"}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
            aria-label="Close editor"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-5 rounded-xl border border-border bg-card p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="article-title">
                Title
              </label>
              <input
                id="article-title"
                className={inputClass}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="article-category">
                Category
              </label>
              <input
                id="article-category"
                className={inputClass}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="article-image">
                Header Image URL
              </label>
              <input
                id="article-image"
                className={inputClass}
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="article-author">
                Author Name
              </label>
              <input
                id="article-author"
                className={inputClass}
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="article-summary">
              Summary
            </label>
            <textarea
              id="article-summary"
              rows={2}
              className={inputClass}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />
          </div>

          <div>
            <span className={labelClass}>Article Content</span>
            <div className="mt-1 flex flex-wrap items-center gap-2 rounded-t-md border border-border bg-muted/40 p-2">
              <button type="button" className={toolButton} onClick={() => exec("bold")} aria-label="Bold">
                <Bold className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" className={toolButton} onClick={() => exec("italic")} aria-label="Italic">
                <Italic className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                className={toolButton}
                onClick={() => exec("underline")}
                aria-label="Underline"
              >
                <Underline className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="mx-1 h-5 w-px bg-border" />
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Text color ${color}`}
                  className="h-6 w-6 rounded-full border border-border"
                  style={{ backgroundColor: color }}
                  onClick={() => exec("foreColor", color)}
                />
              ))}
              <span className="mx-1 h-5 w-px bg-border" />
              <div className="flex flex-1 items-center gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring"
                  placeholder="Insert image from URL"
                  value={embedUrl}
                  onChange={(e) => setEmbedUrl(e.target.value)}
                />
                <button
                  type="button"
                  className={cn(toolButton, "w-auto px-2")}
                  onClick={insertImage}
                  aria-label="Insert image"
                >
                  <ImageIcon className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div
              ref={bodyRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="Article content"
              className="min-h-[320px] w-full rounded-b-md border border-t-0 border-border bg-background p-4 text-sm leading-relaxed text-foreground outline-none [&_img]:my-4 [&_img]:h-auto [&_img]:w-full [&_img]:max-w-full [&_img]:rounded-xl [&_img]:border [&_img]:border-border/10 [&_img]:object-cover"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button type="button" className={blueButton} disabled={saving} onClick={submit}>
              {saving ? "Publishing…" : "Publish Article"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
