import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import {
  deleteLeagueChatMessage,
  listLeagueChatMessages,
  postLeagueChatMessage,
} from "@/lib/league-chat";
import { visibleRefetchInterval } from "@/lib/page-visibility";
import { cn } from "@/lib/utils";

const CHAT_POLL_MS = 10_000;

/**
 * Native league chat room UI.
 * Not mounted on any route yet — pass `nativeLeagueId` when wiring Chat into the shell.
 */
export function LeagueChatPanel({
  nativeLeagueId,
  className,
}: {
  nativeLeagueId: string;
  className?: string;
}) {
  const { user, ready } = useAuth();
  const { data: isAdmin } = useIsAdmin(user?.id ?? null);
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const leagueId = nativeLeagueId.trim();

  const messagesQuery = useQuery({
    queryKey: ["league-chat", leagueId],
    enabled: Boolean(user?.id && leagueId),
    staleTime: 5_000,
    refetchInterval: visibleRefetchInterval(CHAT_POLL_MS),
    queryFn: () => listLeagueChatMessages(leagueId),
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

  const messages = messagesQuery.data ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

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
      <section className={cn("rounded-xl border border-slate-200 bg-white p-4 text-sm text-muted-foreground", className)}>
        Loading chat…
      </section>
    );
  }

  if (!user) {
    return (
      <section className={cn("rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800", className)}>
        Sign in to view league chat. Only league members can read or post.
      </section>
    );
  }

  if (!leagueId) {
    return (
      <section className={cn("rounded-xl border border-slate-200 bg-white p-4 text-sm text-muted-foreground", className)}>
        No league selected.
      </section>
    );
  }

  return (
    <section
      className={cn(
        "flex min-h-[22rem] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm",
        className,
      )}
    >
      <header className="border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h2 className="display-title text-lg uppercase tracking-wide text-slate-900">Chat</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          League members only · refreshes while this tab is open
        </p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messagesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading messages…</p>
        ) : messagesQuery.isError ? (
          <p className="text-sm text-destructive">
            {messagesQuery.error instanceof Error
              ? messagesQuery.error.message
              : "Could not load chat."}
          </p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet. Say hello.</p>
        ) : (
          <ul className="space-y-3">
            {messages.map((m) => {
              const mine = m.user_id === user.id;
              const canDelete = mine || isAdmin === true;
              return (
                <li key={m.id} className={cn("flex gap-2", mine ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 text-sm",
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
                        {new Date(m.created_at).toLocaleString()}
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
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-slate-200 p-3">
        <label className="sr-only" htmlFor="league-chat-input">
          Message
        </label>
        <textarea
          id="league-chat-input"
          rows={2}
          maxLength={1000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Message your league…"
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-600"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Enter to send · Shift+Enter for new line</p>
          <button
            type="button"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            disabled={postMutation.isPending || !body.trim()}
            onClick={submit}
          >
            {postMutation.isPending ? "Sending…" : "Send"}
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
