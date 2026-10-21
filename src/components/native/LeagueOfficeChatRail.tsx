import { Link, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  FantasyActivityList,
  type FantasyActivityItem,
} from "@/components/native/fantasy";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import { supabase } from "@/integrations/supabase/client";
import {
  deleteLeagueChatMessage,
  listLeagueChatMessages,
  postLeagueChatMessage,
  type LeagueChatMessage,
} from "@/lib/league-chat";
import { listNativeTransactions } from "@/lib/native-league.functions";
import {
  isNativeSettingsChangeType,
  type NativeSettingsChangeEntry,
} from "@/lib/native-league-settings-changelog";
import { visibleRefetchInterval } from "@/lib/page-visibility";
import { loadPlayersCatalog } from "@/lib/players-catalog";
import { formatRelativeTimeAgo, parseServerDateMs } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

const CHAT_POLL_MS = 10_000;
const TXN_POLL_MS = 20_000;

type RailTxnRow = FantasyActivityItem & {
  settingsChanges?: NativeSettingsChangeEntry[] | null;
  changedByName?: string | null;
};

type FeedKind = "chat" | "transaction" | "settings";

type FeedItem = {
  id: string;
  kind: FeedKind;
  at: number;
  chat?: LeagueChatMessage;
  txn?: FantasyActivityItem;
  settings?: {
    id: number;
    createdAt: string;
    who: string;
    changes: NativeSettingsChangeEntry[];
  };
};

/**
 * Persistent Fantasy right rail: live chat + league transactions + settings
 * changes in one timeline (Sleeper-style flow, Broadcast chrome).
 */
export function LeagueOfficeChatRail({
  linkId,
  nativeLeagueId,
  className,
}: {
  linkId: string;
  nativeLeagueId: string;
  className?: string;
}) {
  const { user, ready } = useAuth();
  const { data: isAdmin } = useIsAdmin(user?.id ?? null);
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [pendingScroll, setPendingScroll] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  /** False until we've pinned to the newest messages after layout has a real height. */
  const initialScrollDone = useRef(false);
  const stickToBottom = useRef(true);
  const leagueId = nativeLeagueId.trim();
  // Rail stays mounted across Fantasy/league routes — re-pin on each page.
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const scrollScrollerToBottom = (smooth = false) => {
    const node = scrollerRef.current;
    if (!node) return;
    // Prefer scrollTop over scrollIntoView — the latter can scroll the page
    // (sticky rail ancestors) and leave the feed mid-list on some routes.
    if (smooth && typeof node.scrollTo === "function") {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    } else {
      node.scrollTop = node.scrollHeight;
    }
  };

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // New league room or route → jump to latest after the next paint/layout.
  useEffect(() => {
    initialScrollDone.current = false;
    stickToBottom.current = true;
  }, [leagueId, pathname]);

  const cache = useSleeperPlayers();
  const fallback = useQuery({
    queryKey: ["players-catalog"],
    queryFn: () => loadPlayersCatalog(),
    enabled: Boolean(cache.error) && !cache.data,
    staleTime: 1000 * 60 * 30,
  });
  const players = cache.data?.players ?? fallback.data?.players ?? [];
  const playersById = useMemo(() => {
    const map = new Map<string, (typeof players)[number]>();
    for (const p of players) map.set(p.id, p);
    return map;
  }, [players]);

  const messagesQuery = useQuery({
    queryKey: ["league-chat", leagueId],
    enabled: Boolean(user?.id && leagueId),
    staleTime: 5_000,
    refetchInterval: visibleRefetchInterval(CHAT_POLL_MS),
    queryFn: () => listLeagueChatMessages(leagueId),
  });

  const txnQuery = useQuery({
    queryKey: ["native-transactions", linkId, "chat-rail"],
    enabled: Boolean(user?.id && linkId),
    staleTime: 15_000,
    refetchInterval: visibleRefetchInterval(TXN_POLL_MS),
    queryFn: () => listNativeTransactions({ data: { linkId, limit: 40 } }),
  });

  const profileQuery = useQuery({
    queryKey: ["profile-display-name", user?.id],
    enabled: Boolean(user?.id),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", user!.id)
        .maybeSingle();
      if (err) throw new Error(err.message);
      return data;
    },
  });

  const postMutation = useMutation({
    mutationFn: postLeagueChatMessage,
    onSuccess: async () => {
      setBody("");
      setError(null);
      setPendingScroll(true);
      await queryClient.invalidateQueries({ queryKey: ["league-chat", leagueId] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteLeagueChatMessage,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["league-chat", leagueId] });
    },
  });

  const feed = useMemo(() => {
    const items: FeedItem[] = [];
    for (const m of messagesQuery.data ?? []) {
      const at = parseServerDateMs(m.created_at);
      if (!Number.isFinite(at)) continue;
      items.push({
        id: `chat-${m.id}`,
        kind: "chat",
        at,
        chat: m,
      });
    }
    for (const row of (txnQuery.data ?? []) as RailTxnRow[]) {
      const at = parseServerDateMs(row.createdAt);
      if (!Number.isFinite(at)) continue;
      if (isNativeSettingsChangeType(row.type)) {
        const changes = Array.isArray(row.settingsChanges) ? row.settingsChanges : [];
        if (!changes.length) continue;
        items.push({
          id: `settings-${row.id}`,
          kind: "settings",
          at,
          settings: {
            id: row.id,
            createdAt: row.createdAt,
            who:
              row.changedByName?.trim() ||
              row.teamName?.trim() ||
              "Commissioner",
            changes,
          },
        });
        continue;
      }
      items.push({
        id: `txn-${row.id}`,
        kind: "transaction",
        at,
        txn: row,
      });
    }
    items.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    return items;
  }, [messagesQuery.data, txnQuery.data]);

  const feedLoading = messagesQuery.isLoading || txnQuery.isLoading;

  // Track whether the user is reading older messages (don't yank them down on poll).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottom.current = gap < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [leagueId, ready, user?.id]);

  // Default to newest on load / route change (retry until sticky rail has height).
  // Then stick after your send or when already near bottom — never via scrollIntoView.
  useEffect(() => {
    if (feed.length === 0 || feedLoading) return;

    let cancelled = false;
    const pinIfNeeded = (smooth = false) => {
      if (cancelled) return;
      const node = scrollerRef.current;
      if (!node) return;
      // Wait until flex/sticky layout gives the scroller a measurable height.
      if (node.clientHeight < 40) return;

      if (!initialScrollDone.current) {
        scrollScrollerToBottom(false);
        // Double-apply after layout; some pages paint the sticky height a frame later.
        node.scrollTop = node.scrollHeight;
        const gap = node.scrollHeight - node.scrollTop - node.clientHeight;
        if (gap <= 4) {
          initialScrollDone.current = true;
          stickToBottom.current = true;
        }
        return;
      }

      if (pendingScroll || stickToBottom.current) {
        scrollScrollerToBottom(smooth && pendingScroll);
      }
    };

    pinIfNeeded(false);
    const raf1 = requestAnimationFrame(() => {
      pinIfNeeded(false);
      requestAnimationFrame(() => pinIfNeeded(false));
    });
    const t1 = window.setTimeout(() => pinIfNeeded(false), 50);
    const t2 = window.setTimeout(() => pinIfNeeded(false), 200);
    const t3 = window.setTimeout(() => pinIfNeeded(false), 500);
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => pinIfNeeded(false))
        : null;
    if (ro) {
      if (scrollerRef.current) ro.observe(scrollerRef.current);
      if (rootRef.current) ro.observe(rootRef.current);
    }

    if (pendingScroll && initialScrollDone.current) {
      pinIfNeeded(true);
      setPendingScroll(false);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      ro?.disconnect();
    };
  }, [feed.length, pendingScroll, feedLoading, leagueId, pathname]);

  const metaName =
    typeof user?.user_metadata?.["full_name"] === "string"
      ? user.user_metadata["full_name"]
      : "";
  const displayName =
    profileQuery.data?.full_name?.trim() ||
    metaName.trim() ||
    user?.email?.split("@")[0] ||
    "Member";

  const submit = () => {
    if (!user) {
      setError("Sign in to chat.");
      return;
    }
    const trimmed = body.trim();
    if (!trimmed) {
      setError("Write a message first.");
      return;
    }
    postMutation.mutate({
      nativeLeagueId: leagueId,
      userId: user.id,
      authorName: String(displayName),
      body: trimmed,
    });
  };

  if (!ready) {
    return (
      <section
        className={cn(
          "rounded-xl border border-slate-200 bg-white p-4 text-sm text-muted-foreground shadow-sm",
          className,
        )}
      >
        Loading chat…
      </section>
    );
  }

  if (!user) {
    return (
      <section
        className={cn(
          "rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800 shadow-sm",
          className,
        )}
      >
        Sign in to view league chat, transactions, and settings updates.
      </section>
    );
  }

  if (!leagueId || !linkId) {
    return (
      <section
        className={cn(
          "rounded-xl border border-slate-200 bg-white p-4 text-sm text-muted-foreground shadow-sm",
          className,
        )}
      >
        Select a league to open chat.
      </section>
    );
  }

  const loading = feedLoading;

  return (
    <section
      ref={rootRef}
      className={cn(
        "flex min-h-[22rem] flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:min-h-0",
        className,
      )}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <h2 className="display-title text-lg uppercase tracking-wide text-slate-900">
            League <span className="text-primary">Chat</span>
          </h2>
        </div>
        <Link
          to="/league/$linkId/transactions"
          params={{ linkId }}
          className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 hover:underline"
        >
          All activity
        </Link>
      </header>

      <div ref={scrollerRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {loading ? (
          <p className="px-1 text-sm text-muted-foreground">Loading feed…</p>
        ) : feed.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">
            No messages or league activity yet. Say hello to start the room.
          </p>
        ) : (
          <ul className="space-y-3">
            {feed.map((item) => {
              if (item.kind === "chat" && item.chat) {
                const m = item.chat;
                const mine = m.user_id === user.id;
                const canDelete = mine || isAdmin === true;
                return (
                  <li key={item.id} className={cn("flex gap-2", mine ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[90%] rounded-lg px-3 py-2 text-sm",
                        mine ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-900",
                      )}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span
                          className={cn(
                            "text-xs font-semibold",
                            mine ? "text-blue-100" : "text-slate-600",
                          )}
                        >
                          {m.author_name}
                        </span>
                        <time
                          className={cn(
                            "text-[10px] uppercase tracking-wide",
                            mine ? "text-blue-100/80" : "text-muted-foreground",
                          )}
                          dateTime={m.created_at}
                        >
                          {formatRelativeTimeAgo(item.at, nowMs)}
                        </time>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap leading-relaxed">{m.body}</p>
                      {canDelete ? (
                        <button
                          type="button"
                          className={cn(
                            "mt-1 text-[11px] font-semibold underline-offset-2 hover:underline",
                            mine ? "text-blue-100" : "text-slate-500",
                          )}
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(m.id)}
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              }

              if (item.kind === "settings" && item.settings) {
                const s = item.settings;
                return (
                  <li
                    key={item.id}
                    className="rounded-lg border border-amber-200/80 bg-amber-50/70 px-3 py-2.5"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-xs font-bold uppercase tracking-wide text-amber-900">
                        Settings change
                      </p>
                      <time className="text-[10px] uppercase tracking-wide text-amber-800/80">
                        {formatRelativeTimeAgo(item.at, nowMs)}
                      </time>
                    </div>
                    <p className="mt-0.5 text-xs font-medium text-amber-950">{s.who}</p>
                    <ul className="mt-1.5 space-y-1">
                      {s.changes.slice(0, 4).map((c, idx) => (
                        <li key={`${s.id}-${idx}`} className="text-xs text-amber-950/90">
                          <span className="font-semibold">{c.label}</span>
                          {c.from != null || c.to != null ? (
                            <span className="text-amber-900/80">
                              {" "}
                              {c.from ?? "—"} → {c.to ?? "—"}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    <Link
                      to="/account/leagues/native/$linkId"
                      params={{ linkId }}
                      className="mt-1.5 inline-block text-[11px] font-semibold text-blue-700 hover:underline"
                    >
                      League Settings
                    </Link>
                  </li>
                );
              }

              if (item.kind === "transaction" && item.txn) {
                return (
                  <li
                    key={item.id}
                    className="rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-2"
                  >
                    <FantasyActivityList
                      items={[item.txn]}
                      playersById={playersById}
                      emptyMessage=""
                    />
                  </li>
                );
              }

              return null;
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-slate-200 p-3">
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="league-office-chat-input">
            Message
          </label>
          <input
            id="league-office-chat-input"
            type="text"
            maxLength={1000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Enter message…"
            className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-600"
          />
          <button
            type="button"
            className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            disabled={postMutation.isPending || !body.trim()}
            onClick={submit}
          >
            {postMutation.isPending ? "…" : "Send"}
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
