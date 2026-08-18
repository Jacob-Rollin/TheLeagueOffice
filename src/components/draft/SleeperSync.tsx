import { useMutation } from "@tanstack/react-query";
import { Link2, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { LeagueLink, LeagueSyncInput } from "@/hooks/use-draft";
import { getLeagueSync, getUserLeagues } from "@/lib/league.functions";
import type { LeagueSummary } from "@/lib/league.server";

const HOME_KEY = "league-office-link-v1";

function savedLink(): { username: string; leagueId: string } | null {
  try {
    const raw = localStorage.getItem(HOME_KEY);
    return raw ? (JSON.parse(raw) as { username: string; leagueId: string }) : null;
  } catch {
    return null;
  }
}

export function SleeperSync({
  link,
  onApply,
  onUnlink,
}: {
  link: LeagueLink | null;
  onApply: (sync: LeagueSyncInput, meta: LeagueLink) => void;
  onUnlink: () => void;
}) {
  const [username, setUsername] = useState(() => link?.username ?? savedLink()?.username ?? "");
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const leaguesM = useMutation({
    mutationFn: (name: string) => getUserLeagues({ data: { username: name } }),
  });
  const syncM = useMutation({
    mutationFn: (vars: { leagueId: string; username: string }) => getLeagueSync({ data: vars }),
  });

  const apply = async (leagueId: string, name: string) => {
    setError(null);
    const res = await syncM.mutateAsync({ leagueId, username: username.trim() });
    if (!res) return setError("Couldn't load that league.");
    onApply(res, {
      leagueId,
      leagueName: res.league.name || name,
      username: username.trim(),
      syncedAt: new Date().toISOString(),
    });
    setLeagues([]);
  };

  const search = async () => {
    setError(null);
    setLeagues([]);
    const res = await leaguesM.mutateAsync(username.trim());
    if (!res.length) return setError("No leagues found for that Sleeper username.");
    if (res.length === 1) return apply(res[0]!.id, res[0]!.name);
    setLeagues(res);
  };

  const busy = leaguesM.isPending || syncM.isPending;

  return (
    <section className="space-y-2">
      <h3 className="font-display text-xs uppercase tracking-widest text-muted-foreground">
        Sleeper league
      </h3>

      {link ? (
        <div className="space-y-2 rounded-lg border border-primary/40 bg-card px-3 py-2">
          <div className="flex items-center gap-2">
            <Link2 className="size-4 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-sm">{link.leagueName}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                @{link.username} · synced {new Date(link.syncedAt).toLocaleString()}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1 gap-1.5"
              disabled={busy}
              onClick={() => apply(link.leagueId, link.leagueName)}
            >
              <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} />
              Resync rosters
            </Button>
            <Button size="sm" variant="secondary" onClick={onUnlink}>
              Unlink
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            value={username}
            placeholder="Sleeper username"
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && username.trim() && void search()}
            className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button size="sm" disabled={busy || !username.trim()} onClick={() => void search()}>
            {busy ? "…" : "Link"}
          </Button>
        </div>
      )}

      {leagues.length > 0 && (
        <ul className="space-y-1">
          {leagues.map((l) => (
            <li key={l.id}>
              <button
                onClick={() => void apply(l.id, l.name)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary"
              >
                <div className="truncate font-display text-sm">{l.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {l.season} · {l.teams} teams · {l.scoring}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-[11px] text-muted-foreground">
        Syncing pulls scoring, roster slots, team names and every rostered player straight from
        Sleeper.
      </p>
    </section>
  );
}
