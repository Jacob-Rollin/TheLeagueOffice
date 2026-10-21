export type ArticleContentPart =
  | { type: "html"; html: string }
  | { type: "poll"; pollId: string };

/**
 * Split authored article HTML so poll markers become first-class React children
 * (under QueryClient / Router). Works even when contenteditable nests .lo-poll.
 */
export function splitArticleContent(html: string): ArticleContentPart[] {
  const raw = html ?? "";
  if (!raw.trim()) return [];

  if (typeof DOMParser === "undefined") {
    return splitArticleContentRegex(raw);
  }

  try {
    const doc = new DOMParser().parseFromString(`<div id="lo-root">${raw}</div>`, "text/html");
    const root = doc.getElementById("lo-root");
    if (!root) return [{ type: "html", html: raw }];

    const pollEls = Array.from(root.querySelectorAll(".lo-poll[data-poll-id]"));
    if (pollEls.length === 0) {
      // Also accept data-poll-id without class (contenteditable sometimes drops classes).
      const byAttr = Array.from(root.querySelectorAll("[data-poll-id]"));
      if (byAttr.length === 0) return [{ type: "html", html: raw }];
      return splitByReplacingPollNodes(root, byAttr, raw);
    }
    return splitByReplacingPollNodes(root, pollEls, raw);
  } catch {
    return splitArticleContentRegex(raw);
  }
}

function splitByReplacingPollNodes(
  root: HTMLElement,
  pollEls: Element[],
  fallbackHtml: string,
): ArticleContentPart[] {
  const ids: string[] = [];
  pollEls.forEach((el, index) => {
    const pollId = el.getAttribute("data-poll-id")?.trim();
    if (!pollId) {
      el.remove();
      return;
    }
    ids.push(pollId);
    const marker = root.ownerDocument.createComment(`lo-poll:${ids.length - 1}`);
    el.replaceWith(marker);
  });

  if (ids.length === 0) return [{ type: "html", html: fallbackHtml }];

  const serialized = root.innerHTML;
  const parts: ArticleContentPart[] = [];
  const re = /<!--lo-poll:(\d+)-->/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(serialized)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "html", html: serialized.slice(lastIndex, match.index) });
    }
    const idx = Number(match[1]);
    const pollId = ids[idx];
    if (pollId) parts.push({ type: "poll", pollId });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < serialized.length) {
    parts.push({ type: "html", html: serialized.slice(lastIndex) });
  }
  return parts.length > 0 ? parts : [{ type: "html", html: fallbackHtml }];
}

function splitArticleContentRegex(html: string): ArticleContentPart[] {
  const re =
    /<div\b[^>]*\bdata-poll-id\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/div>/gi;
  const parts: ArticleContentPart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "html", html: html.slice(lastIndex, match.index) });
    }
    const pollId = match[1]?.trim();
    if (pollId) parts.push({ type: "poll", pollId });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < html.length) {
    parts.push({ type: "html", html: html.slice(lastIndex) });
  }
  return parts.length > 0 ? parts : [{ type: "html", html }];
}
