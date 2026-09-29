import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type ArticleShareProps = {
  slug: string;
  title: string;
  summary?: string | null | undefined;
};

const buttonClass = cn(
  "rounded-md border border-blue-600 bg-transparent px-3.5 py-1.5",
  "text-sm font-medium text-blue-600 transition-colors",
  "hover:bg-blue-600 hover:text-white",
);

export function ArticleShare({ slug, title, summary }: ArticleShareProps) {
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const url =
    typeof window !== "undefined" ? `${window.location.origin}/articles/${slug}` : `/articles/${slug}`;

  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const u = encodeURIComponent(url);
  const t = encodeURIComponent(title);
  const links = [
    { label: "X", href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
    { label: "Facebook", href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    {
      label: "Email",
      href: `mailto:?subject=${t}&body=${encodeURIComponent(`${summary ? `${summary}\n\n` : ""}${url}`)}`,
    },
  ];

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title, text: summary ?? title, url });
    } catch {
      /* dismissed */
    }
  };

  return (
    <div className="mt-10 border-t border-border pt-6">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Share This Briefing
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {links.map((link) => (
          <a
            key={link.label}
            href={link.href}
            target={link.label === "Email" ? undefined : "_blank"}
            rel="noopener noreferrer"
            className={buttonClass}
          >
            {link.label}
          </a>
        ))}
        <button type="button" onClick={() => void copyLink()} className={buttonClass} aria-live="polite">
          {copied ? "Link Copied" : "Copy Link"}
        </button>
        {canNativeShare ? (
          <button type="button" onClick={() => void nativeShare()} className={buttonClass}>
            More Options
          </button>
        ) : null}
      </div>
    </div>
  );
}
