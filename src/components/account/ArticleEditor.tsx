import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  Bold,
  ChevronDown,
  Eraser,
  Highlighter,
  Image as ImageIcon,
  Italic,
  ListChecks,
  Plus,
  Quote,
  Underline,
  UserRound,
  X,
} from "lucide-react";

import { ArticleView, type ArticleViewData } from "@/components/articles/ArticleView";
import { useAuth } from "@/hooks/useAuth";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { ArticleInput, ArticleRow } from "@/lib/articles";
import {
  countPollVotes,
  createArticlePoll,
  fetchArticlePollBundle,
  pollEmbedHtml,
  pollEmbedInnerHtml,
  updateArticlePoll,
} from "@/lib/article-polls";
import { renderPlayerHeaderHtml, renderPlayerMetaHtml } from "@/lib/weekly-desk-html";
import { cn } from "@/lib/utils";

type PollDraftQuestion = { prompt: string; options: string[] };

function emptyPollQuestion(): PollDraftQuestion {
  return { prompt: "", options: ["", ""] };
}

function resetPollDraft() {
  return {
    title: "",
    leagueId: "",
    questions: [emptyPollQuestion()] as PollDraftQuestion[],
    editingPollId: null as string | null,
    voteCount: 0,
  };
}

const inputClass =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-black";
const blueButton =
  "rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-60";
const outlineBlueButton =
  "rounded-md border border-blue-600 bg-transparent px-4 py-2 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-600 hover:text-white";
const toolButton =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-foreground transition-colors hover:bg-muted";

const COLORS = ["#0f172a", "#2563eb", "#dc2626", "#16a34a", "#d97706"];
const HIGHLIGHTS = ["#dbeafe", "#dcfce7", "#fef9c3", "#fee2e2", "#ede9fe"];

const SIZES: { label: string; block: string }[] = [
  { label: "Heading 1", block: "h1" },
  { label: "Heading 2", block: "h2" },
  { label: "Subheading", block: "h3" },
  { label: "Body Text", block: "p" },
];

const ALLOWED_TAGS = new Set([
  "P","BR","B","STRONG","I","EM","U","A","UL","OL","LI","H1","H2","H3","BLOCKQUOTE","SPAN","FONT","IMG","DIV",
]);

/** Keep poll markers intact before preview/publish (contenteditable can drop class). */
function normalizePollMarkersInHtml(html: string): string {
  if (!html || typeof document === "undefined") return html;
  const holder = document.createElement("div");
  holder.innerHTML = html;
  holder.querySelectorAll("[data-poll-id]").forEach((node) => {
    const el = node as HTMLElement;
    const pollId = el.getAttribute("data-poll-id")?.trim();
    if (!pollId) return;
    el.classList.add("lo-poll");
    el.setAttribute("data-poll-id", pollId);
    el.setAttribute("contenteditable", "false");
  });
  return holder.innerHTML;
}

/** Strips foreign markup, highlights and background colors from pasted HTML. */
function sanitizePastedHtml(html: string): string {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      walk(child);
      if (!ALLOWED_TAGS.has(child.tagName)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      const el = child as HTMLElement;
      const pollIdAttr = el.getAttribute("data-poll-id")?.trim();
      if (pollIdAttr || el.classList.contains("lo-poll")) {
        const pollId = pollIdAttr || el.getAttribute("data-poll-id");
        el.removeAttribute("style");
        el.removeAttribute("bgcolor");
        el.removeAttribute("id");
        el.className = "lo-poll";
        if (pollId) el.setAttribute("data-poll-id", pollId);
        el.setAttribute("contenteditable", "false");
        continue;
      }
      const color = el.style.color;
      el.removeAttribute("class");
      el.removeAttribute("style");
      el.removeAttribute("bgcolor");
      el.removeAttribute("id");
      if (color && !/transparent/i.test(color)) el.style.color = color;
    }
  };
  walk(holder);
  return holder.innerHTML;
}

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
  const [featuredId, setFeaturedId] = useState(article?.featured_player_id ?? "");
  const [featuredName, setFeaturedName] = useState(article?.featured_player_name ?? "");
  const [featuredPos, setFeaturedPos] = useState(article?.featured_player_pos ?? "");
  const [featuredTeam, setFeaturedTeam] = useState(article?.featured_player_team ?? "");
  const { user } = useAuth();
  const [embedUrl, setEmbedUrl] = useState("");
  const [playerQuery, setPlayerQuery] = useState("");
  const [playerStatLine, setPlayerStatLine] = useState("");
  const [playerPickerOpen, setPlayerPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [markerOpen, setMarkerOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollBusy, setPollBusy] = useState(false);
  const [pollTitle, setPollTitle] = useState("");
  const [pollLeagueId, setPollLeagueId] = useState("");
  const [pollQuestions, setPollQuestions] = useState<PollDraftQuestion[]>([emptyPollQuestion()]);
  const [editingPollId, setEditingPollId] = useState<string | null>(null);
  const [editingVoteCount, setEditingVoteCount] = useState(0);
  const [preview, setPreview] = useState<ArticleViewData | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const savedRange = useRef<Range | null>(null);
  const deferredPlayerQuery = useDeferredValue(playerQuery.trim().toLowerCase());
  const { data: playersPayload, loading: playersLoading } = useSleeperPlayers();

  const playerHits = useMemo(() => {
    if (deferredPlayerQuery.length < 2) return [];
    const catalog = playersPayload?.players ?? [];
    const out: { id: string; name: string; pos: string; team: string }[] = [];
    for (const p of catalog) {
      if (!p.name.toLowerCase().includes(deferredPlayerQuery)) continue;
      const pos = String(p.pos || "").toUpperCase() === "DEF" ? "DST" : String(p.pos || "").toUpperCase();
      out.push({ id: p.id, name: p.name, pos, team: p.team || "FA" });
      if (out.length >= 8) break;
    }
    return out;
  }, [deferredPlayerQuery, playersPayload]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.innerHTML = article?.content ?? "";
  }, [article]);

  /** Remembers the caret/selection inside the writer before focus moves to a toolbar field. */
  const rememberSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (bodyRef.current?.contains(range.commonAncestorContainer)) {
      savedRange.current = range.cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    const editor = bodyRef.current;
    if (!editor) return;
    editor.focus();
    const range = savedRange.current;
    if (!range) return;
    try {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    } catch {
      // Stale range after async work — caller should fall back to append.
      savedRange.current = null;
    }
  }, []);

  const exec = (command: string, value?: string) => {
    restoreSelection();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, value);
    rememberSelection();
  };

  /** Insert HTML at the saved caret, or append when selection was lost (common after async polls). */
  const insertHtmlIntoBody = useCallback(
    (html: string) => {
      const editor = bodyRef.current;
      if (!editor) return false;
      editor.focus();

      let placed = false;
      const range = savedRange.current;
      if (range) {
        try {
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          if (editor.contains(range.commonAncestorContainer)) {
            document.execCommand("styleWithCSS", false, "true");
            placed = document.execCommand("insertHTML", false, html);
          }
        } catch {
          placed = false;
        }
      }

      if (!placed) {
        editor.insertAdjacentHTML("beforeend", html);
        placed = true;
      }

      // Move caret after the insert and keep a fresh saved range.
      const selection = window.getSelection();
      if (selection) {
        const end = document.createRange();
        end.selectNodeContents(editor);
        end.collapse(false);
        selection.removeAllRanges();
        selection.addRange(end);
        savedRange.current = end.cloneRange();
      }
      return placed;
    },
    [],
  );

  const insertImage = () => {
    const url = embedUrl.trim();
    if (!url) return;
    exec(
      "insertHTML",
      `<figure class="article-image"><img src="${url}" alt="" /></figure><p><br /></p>`,
    );
    setEmbedUrl("");
  };

  const insertPlayerHeader = (player: { id: string; name: string; pos: string; team: string }) => {
    const html =
      renderPlayerHeaderHtml({
        id: player.id,
        name: player.name,
        pos: player.pos,
        team: player.team,
      }) +
      renderPlayerMetaHtml(playerStatLine.trim() || null) +
      `<p><br /></p>`;
    exec("insertHTML", html);
    setPlayerQuery("");
    setPlayerStatLine("");
    setPlayerPickerOpen(false);
  };

  const clearPollForm = useCallback(() => {
    const draft = resetPollDraft();
    setPollTitle(draft.title);
    setPollLeagueId(draft.leagueId);
    setPollQuestions(draft.questions);
    setEditingPollId(draft.editingPollId);
    setEditingVoteCount(draft.voteCount);
  }, []);

  const closePollPanel = useCallback(() => {
    setPollOpen(false);
    clearPollForm();
  }, [clearPollForm]);

  const openNewPollPanel = useCallback(() => {
    rememberSelection();
    clearPollForm();
    setPollOpen(true);
    setSizeOpen(false);
    setMarkerOpen(false);
    setPlayerPickerOpen(false);
    setError(null);
  }, [clearPollForm, rememberSelection]);

  const refreshPollMarkerLabel = useCallback((pollId: string, title: string | null) => {
    const editor = bodyRef.current;
    if (!editor) return;
    const el = editor.querySelector(`[data-poll-id="${pollId}"]`) as HTMLElement | null;
    if (!el) return;
    el.classList.add("lo-poll");
    el.setAttribute("contenteditable", "false");
    el.innerHTML = pollEmbedInnerHtml(title);
  }, []);

  const openPollEditor = useCallback(
    async (pollId: string) => {
      setPollBusy(true);
      setError(null);
      setPollOpen(true);
      setSizeOpen(false);
      setMarkerOpen(false);
      setPlayerPickerOpen(false);
      try {
        const bundle = await fetchArticlePollBundle(pollId, user?.id ?? null);
        if (!bundle) {
          setError("Could not load that poll for editing.");
          setPollOpen(false);
          return;
        }
        setEditingPollId(pollId);
        setEditingVoteCount(countPollVotes(bundle));
        setPollTitle(bundle.poll.title ?? "");
        setPollLeagueId(bundle.poll.native_league_id ?? "");
        setPollQuestions(
          bundle.questions.length > 0
            ? bundle.questions.map((q) => ({
                prompt: q.prompt,
                options:
                  q.options.length >= 2 ? q.options.map((o) => o.label) : ["", ""],
              }))
            : [emptyPollQuestion()],
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load poll.");
        setPollOpen(false);
      } finally {
        setPollBusy(false);
      }
    },
    [user?.id],
  );

  const onBodyClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      const pollEl = target?.closest?.("[data-poll-id]") as HTMLElement | null;
      if (!pollEl || !bodyRef.current?.contains(pollEl)) return;
      const pollId = pollEl.getAttribute("data-poll-id")?.trim();
      if (!pollId) return;
      event.preventDefault();
      event.stopPropagation();
      void openPollEditor(pollId);
    },
    [openPollEditor],
  );

  const savePollBlock = async () => {
    if (!user?.id) {
      setError("Sign in as an admin to save a poll.");
      return;
    }
    // Capture caret before await — focus will leave the editor while the poll is created.
    rememberSelection();
    setPollBusy(true);
    setError(null);
    try {
      if (editingPollId) {
        if (
          editingVoteCount > 0 &&
          !window.confirm(
            `This poll already has ${editingVoteCount} vote${editingVoteCount === 1 ? "" : "s"}. Saving will clear those votes and rewrite the questions. Continue?`,
          )
        ) {
          return;
        }
        const poll = await updateArticlePoll({
          pollId: editingPollId,
          title: pollTitle.trim() || null,
          requireAuth: true,
          nativeLeagueId: pollLeagueId.trim() || null,
          questions: pollQuestions,
        });
        refreshPollMarkerLabel(poll.id, pollTitle.trim() || poll.title);
        closePollPanel();
        return;
      }

      const poll = await createArticlePoll({
        createdBy: user.id,
        title: pollTitle.trim() || null,
        requireAuth: true,
        nativeLeagueId: pollLeagueId.trim() || null,
        questions: pollQuestions,
      });
      const ok = insertHtmlIntoBody(pollEmbedHtml(poll.id, pollTitle.trim() || poll.title));
      const bodyHtml = bodyRef.current?.innerHTML ?? "";
      if (!ok || !bodyHtml.includes(`data-poll-id="${poll.id}"`)) {
        setError(
          "Poll was created in the database but not found in the article body. Scroll the writer — look for a blue poll box — or try Insert again.",
        );
        return;
      }
      closePollPanel();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save poll.");
    } finally {
      setPollBusy(false);
    }
  };

  const clearFormatting = () => {
    restoreSelection();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("removeFormat");
    document.execCommand("hiliteColor", false, "transparent");
    document.execCommand("formatBlock", false, "p");
    rememberSelection();
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    const clean = html
      ? sanitizePastedHtml(html)
      : text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);
    document.execCommand("insertHTML", false, clean);
    rememberSelection();
  };

  const openPreview = () => {
    setSizeOpen(false);
    setMarkerOpen(false);
    setPollOpen(false);
    const content = normalizePollMarkersInHtml(bodyRef.current?.innerHTML ?? "");
    if (bodyRef.current) bodyRef.current.innerHTML = content;
    setPreview({
      title: title.trim() || "Untitled Article",
      category: category.trim() || "Uncategorized",
      summary: summary.trim(),
      content,
      image_url: imageUrl.trim(),
      author_name: author.trim() || "The League Office",
      created_at: article?.created_at ?? new Date().toISOString(),
      featured_player_id: featuredId.trim() || null,
      featured_player_name: featuredName.trim() || null,
      featured_player_pos: featuredPos.trim() || null,
      featured_player_team: featuredTeam.trim() || null,
    });
  };

  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  const submit = () => {
    const content = normalizePollMarkersInHtml(bodyRef.current?.innerHTML ?? "");
    if (bodyRef.current) bodyRef.current.innerHTML = content;
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
      featured_player_id: featuredId.trim() || null,
      featured_player_name: featuredName.trim() || null,
      featured_player_pos: featuredPos.trim() || null,
      featured_player_team: featuredTeam.trim() || null,
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
                placeholder="https://… (stock football landscape)"
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

          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
            <p className={labelClass}>Hero player overlap</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Optional. Shows a player chip over the header stock image. Leave blank for image-only.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="article-featured-id">
                  Player ID
                </label>
                <input
                  id="article-featured-id"
                  className={inputClass}
                  value={featuredId}
                  onChange={(e) => setFeaturedId(e.target.value)}
                  placeholder="Sleeper id"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="article-featured-name">
                  Player name
                </label>
                <input
                  id="article-featured-name"
                  className={inputClass}
                  value={featuredName}
                  onChange={(e) => setFeaturedName(e.target.value)}
                  placeholder="Display name"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="article-featured-pos">
                  Position
                </label>
                <input
                  id="article-featured-pos"
                  className={inputClass}
                  value={featuredPos}
                  onChange={(e) => setFeaturedPos(e.target.value)}
                  placeholder="RB"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="article-featured-team">
                  Team
                </label>
                <input
                  id="article-featured-team"
                  className={inputClass}
                  value={featuredTeam}
                  onChange={(e) => setFeaturedTeam(e.target.value)}
                  placeholder="DEN"
                />
              </div>
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
            <div className="sticky top-0 z-30 mt-1 flex flex-wrap items-center gap-2 rounded-t-md border border-border bg-card p-2 shadow-sm">
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
              <button
                type="button"
                className={toolButton}
                onClick={() => exec("formatBlock", "blockquote")}
                aria-label="Quote block"
              >
                <Quote className="h-4 w-4" aria-hidden="true" />
              </button>

              <span className="mx-1 h-5 w-px bg-border" />

              <div className="relative">
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-semibold text-foreground hover:bg-muted"
                  onClick={() => {
                    rememberSelection();
                    setSizeOpen((open) => !open);
                    setMarkerOpen(false);
                  }}
                >
                  Text Size
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                {sizeOpen && (
                  <div className="absolute left-0 top-9 z-40 w-40 overflow-hidden rounded-md border border-border bg-card shadow-lg">
                    {SIZES.map((size) => (
                      <button
                        key={size.block}
                        type="button"
                        className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                        onClick={() => {
                          exec("formatBlock", size.block);
                          setSizeOpen(false);
                        }}
                      >
                        {size.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <span className="mx-1 h-5 w-px bg-border" />

              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Text color ${color}`}
                  className="h-6 w-6 rounded-full border border-border"
                  style={{ backgroundColor: color }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => exec("foreColor", color)}
                />
              ))}

              <div className="relative">
                <button
                  type="button"
                  className={toolButton}
                  aria-label="Highlight marker"
                  onClick={() => {
                    rememberSelection();
                    setMarkerOpen((open) => !open);
                    setSizeOpen(false);
                  }}
                >
                  <Highlighter className="h-4 w-4" aria-hidden="true" />
                </button>
                {markerOpen && (
                  <div className="absolute left-0 top-9 z-40 flex gap-2 rounded-md border border-border bg-card p-2 shadow-lg">
                    {HIGHLIGHTS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Highlight ${color}`}
                        className="h-6 w-6 rounded-full border border-border"
                        style={{ backgroundColor: color }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          exec("hiliteColor", color);
                          setMarkerOpen(false);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                className={toolButton}
                aria-label="Clear formatting"
                onClick={clearFormatting}
              >
                <Eraser className="h-4 w-4" aria-hidden="true" />
              </button>

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
                <button
                  type="button"
                  className={cn(toolButton, "w-auto gap-1 px-2 text-xs font-semibold")}
                  onClick={() => {
                    if (pollOpen && !editingPollId) {
                      closePollPanel();
                      return;
                    }
                    openNewPollPanel();
                  }}
                  aria-label="Insert poll"
                >
                  <ListChecks className="h-4 w-4" aria-hidden="true" />
                  Poll
                </button>
              </div>
            </div>

            {pollOpen ? (
              <div className="relative z-20 space-y-4 border border-t-0 border-border bg-slate-50/90 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={labelClass}>
                      {editingPollId ? "Edit poll" : "Insert poll"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {editingPollId
                        ? "Update questions and answers for this embedded poll. Click another poll box in the article to switch."
                        : "Multiple questions on one block. Signed-in users only; optional native-league lock. One vote per question per user. After insert, click the blue poll box to edit."}
                    </p>
                    {editingPollId && editingVoteCount > 0 ? (
                      <p className="mt-2 text-xs font-medium text-amber-800">
                        This poll has {editingVoteCount} existing vote
                        {editingVoteCount === 1 ? "" : "s"}. Saving will clear them.
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className={toolButton}
                    aria-label="Close poll builder"
                    onClick={closePollPanel}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className={labelClass} htmlFor="poll-title">
                      Poll title (optional)
                    </label>
                    <input
                      id="poll-title"
                      className={inputClass}
                      value={pollTitle}
                      onChange={(e) => setPollTitle(e.target.value)}
                      placeholder="Week 8 rule changes"
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="poll-league">
                      Native league ID lock (optional)
                    </label>
                    <input
                      id="poll-league"
                      className={inputClass}
                      value={pollLeagueId}
                      onChange={(e) => setPollLeagueId(e.target.value)}
                      placeholder="Leave blank for any signed-in user"
                    />
                  </div>
                </div>

                <p className="text-xs text-slate-600">
                  Voting always requires a signed-in account (no guests). One vote per question per
                  user.
                </p>

                <div className="space-y-4">
                  {pollQuestions.map((q, qi) => (
                    <div
                      key={qi}
                      className="rounded-lg border border-slate-200 bg-white p-3 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label className={labelClass}>Question {qi + 1}</label>
                        {pollQuestions.length > 1 ? (
                          <button
                            type="button"
                            className="text-xs font-semibold text-slate-500 hover:text-red-600"
                            onClick={() =>
                              setPollQuestions((prev) => prev.filter((_, i) => i !== qi))
                            }
                          >
                            Remove question
                          </button>
                        ) : null}
                      </div>
                      <input
                        className={inputClass}
                        value={q.prompt}
                        onChange={(e) =>
                          setPollQuestions((prev) =>
                            prev.map((row, i) =>
                              i === qi ? { ...row, prompt: e.target.value } : row,
                            ),
                          )
                        }
                        placeholder="Should we move the trade deadline?"
                      />
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Answers
                      </p>
                      {q.options.map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <input
                            className={inputClass}
                            value={opt}
                            onChange={(e) =>
                              setPollQuestions((prev) =>
                                prev.map((row, i) => {
                                  if (i !== qi) return row;
                                  const options = [...row.options];
                                  options[oi] = e.target.value;
                                  return { ...row, options };
                                }),
                              )
                            }
                            placeholder={`Option ${oi + 1}`}
                          />
                          {q.options.length > 2 ? (
                            <button
                              type="button"
                              className={toolButton}
                              aria-label="Remove option"
                              onClick={() =>
                                setPollQuestions((prev) =>
                                  prev.map((row, i) => {
                                    if (i !== qi) return row;
                                    return {
                                      ...row,
                                      options: row.options.filter((_, j) => j !== oi),
                                    };
                                  }),
                                )
                              }
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                      ))}
                      {q.options.length < 8 ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                          onClick={() =>
                            setPollQuestions((prev) =>
                              prev.map((row, i) =>
                                i === qi ? { ...row, options: [...row.options, ""] } : row,
                              ),
                            )
                          }
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          Add answer option
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  {pollQuestions.length < 10 ? (
                    <button
                      type="button"
                      className={outlineBlueButton}
                      onClick={() =>
                        setPollQuestions((prev) => [...prev, emptyPollQuestion()])
                      }
                    >
                      Add question
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={blueButton}
                    disabled={pollBusy}
                    onClick={() => void savePollBlock()}
                  >
                    {pollBusy
                      ? editingPollId
                        ? "Saving…"
                        : "Inserting…"
                      : editingPollId
                        ? "Save poll changes"
                        : "Insert poll into article"}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="relative z-20 border border-t-0 border-border bg-slate-50/90 px-2 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <UserRound className="h-4 w-4 shrink-0 text-blue-700" aria-hidden="true" />
                <input
                  className="min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring"
                  placeholder="Search player to insert header"
                  value={playerQuery}
                  onFocus={() => {
                    rememberSelection();
                    setPlayerPickerOpen(true);
                    setSizeOpen(false);
                    setMarkerOpen(false);
                  }}
                  onChange={(e) => {
                    setPlayerQuery(e.target.value);
                    setPlayerPickerOpen(true);
                  }}
                />
                <input
                  className="min-w-[12rem] flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring"
                  placeholder="Optional under-header line: ROSTERED: 14% or START · vs DET · Opp rank vs QB: 32"
                  value={playerStatLine}
                  onFocus={rememberSelection}
                  onChange={(e) => setPlayerStatLine(e.target.value)}
                />
              </div>
              {playerPickerOpen && deferredPlayerQuery.length >= 2 ? (
                <div className="absolute left-2 right-2 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-card shadow-lg">
                  {playersLoading && playerHits.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">Loading players…</p>
                  ) : playerHits.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
                  ) : (
                    playerHits.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => insertPlayerHeader(p)}
                      >
                        <span className="font-semibold text-foreground">{p.name}</span>
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {p.pos} · {p.team}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>

            <div
              ref={bodyRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="Article content"
              onKeyUp={rememberSelection}
              onMouseUp={rememberSelection}
              onBlur={rememberSelection}
              onPaste={handlePaste}
              onClick={onBodyClick}
              className={
                "min-h-[320px] w-full rounded-b-md border border-t-0 border-border bg-background p-4 text-sm leading-relaxed text-foreground outline-none " +
                "[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-primary [&_blockquote]:bg-muted/15 [&_blockquote]:px-4 [&_blockquote]:py-3 [&_blockquote]:italic " +
                "[&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-black [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold " +
                "[&_img]:my-4 [&_img]:h-auto [&_img]:w-full [&_img]:max-w-full [&_img]:rounded-xl [&_img]:border [&_img]:border-border/10 [&_img]:object-cover " +
                "[&_.lo-player-header]:my-3 [&_.lo-player-header]:inline-block [&_.lo-player-header]:w-[18rem] [&_.lo-player-header]:max-w-full [&_.lo-player-header]:overflow-hidden [&_.lo-player-header]:rounded-xl [&_.lo-player-header]:border [&_.lo-player-header]:border-slate-200 [&_.lo-player-header]:bg-slate-50 [&_.lo-player-header]:align-top " +
                "[&_.lo-player-header_a]:!text-inherit [&_.lo-player-header_a]:!no-underline " +
                "[&_.lo-player-header__inner]:flex [&_.lo-player-header__inner]:items-center [&_.lo-player-header__inner]:gap-3 [&_.lo-player-header__inner]:px-3 [&_.lo-player-header__inner]:py-2.5 " +
                "[&_.lo-player-header__shot]:!my-0 [&_.lo-player-header__shot]:!size-12 [&_.lo-player-header__shot]:!h-12 [&_.lo-player-header__shot]:!w-12 [&_.lo-player-header__shot]:!max-w-12 [&_.lo-player-header__shot]:shrink-0 [&_.lo-player-header__shot]:!rounded-full [&_.lo-player-header__shot]:!border-2 [&_.lo-player-header__shot]:!border-slate-300 [&_.lo-player-header__shot]:bg-slate-200 [&_.lo-player-header__shot]:object-cover [&_.lo-player-header__shot]:!shadow-none " +
                "[&_.lo-player-header__id]:flex [&_.lo-player-header__id]:min-w-0 [&_.lo-player-header__id]:flex-col [&_.lo-player-header__id]:gap-0.5 " +
                "[&_.lo-player-header__name]:block [&_.lo-player-header__name]:truncate [&_.lo-player-header__name]:text-base [&_.lo-player-header__name]:font-bold [&_.lo-player-header__name]:text-slate-900 " +
                "[&_.lo-player-header__sub]:block [&_.lo-player-header__sub]:truncate [&_.lo-player-header__sub]:text-xs [&_.lo-player-header__sub]:font-semibold [&_.lo-player-header__sub]:uppercase [&_.lo-player-header__sub]:text-slate-500 " +
                "[&_.lo-player-meta]:mb-2 [&_.lo-player-meta]:mt-0 [&_.lo-player-meta]:text-xs [&_.lo-player-meta]:font-bold [&_.lo-player-meta]:uppercase [&_.lo-player-meta]:tracking-wide [&_.lo-player-meta]:text-slate-900 " +
                "[&_.lo-poll]:my-3 [&_.lo-poll]:cursor-pointer [&_.lo-poll]:rounded-lg [&_.lo-poll]:border [&_.lo-poll]:border-blue-300 [&_.lo-poll]:bg-blue-50 [&_.lo-poll]:px-3 [&_.lo-poll]:py-3 [&_.lo-poll]:hover:border-blue-500 [&_.lo-poll]:hover:bg-blue-100/80 " +
                "[&_.lo-poll__editor-label]:m-0 [&_.lo-poll__editor-label]:pointer-events-none [&_.lo-poll__editor-label]:text-sm [&_.lo-poll__editor-label]:text-slate-800"
              }
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
            <button type="button" className={outlineBlueButton} onClick={openPreview}>
              Preview
            </button>
            <button type="button" className={blueButton} disabled={saving} onClick={submit}>
              {saving ? "Publishing…" : "Publish Article"}
            </button>
          </div>
        </div>
      </div>

      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Article preview"
          className="fixed inset-0 z-50 overflow-y-auto bg-background"
        >
          <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
            <div className="mx-auto flex w-full max-w-shell flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-600">Preview</p>
                <p className="text-sm text-muted-foreground">
                  This is how the article will look once it's posted. It isn't live yet.
                </p>
              </div>
              <div className="flex gap-3">
                <button type="button" className={outlineBlueButton} onClick={() => setPreview(null)}>
                  Back to Editor
                </button>
                <button
                  type="button"
                  className={blueButton}
                  disabled={saving}
                  onClick={() => {
                    setPreview(null);
                    submit();
                  }}
                >
                  {saving ? "Publishing…" : "Publish Article"}
                </button>
              </div>
            </div>
          </div>

          <main className="mx-auto w-full max-w-shell px-4 pb-16 md:px-8">
            <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-3">
              <div className="min-w-0 lg:col-span-2">
                <ArticleView article={preview} />
              </div>
              <aside className="min-w-0 space-y-4 lg:col-span-1">
                <section className="rounded-xl border border-border/80 bg-card p-4">
                  <h2 className="display-title text-sm uppercase tracking-wide text-zinc-950">
                    Before You Post
                  </h2>
                  <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                    {(
                      [
                        ["Title", Boolean(title.trim())],
                        ["Category", Boolean(category.trim())],
                        ["Summary", Boolean(summary.trim())],
                        ["Header image", Boolean(imageUrl.trim())],
                        ["Article body", Boolean(preview.content.trim())],
                      ] as const
                    ).map(([label, ok]) => (
                      <li key={label} className="flex items-center justify-between gap-3">
                        <span>{label}</span>
                        <span className={ok ? "font-medium text-blue-600" : "font-medium text-red-600"}>
                          {ok ? "Ready" : "Missing"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              </aside>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
