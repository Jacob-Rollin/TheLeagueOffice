/**
 * Browser → Sleeper public transactions for Activity / Transactions pages.
 * Prefer over Fluid getConnectionTransactions so dashboard polls stay off
 * Vercel Active CPU. Player names come from the local catalog when warm.
 */

import type { LeagueActivityEvent, LeagueActivityMove, LeagueTransactionLog } from "@/lib/league.server";
import { readCache, getCached } from "@/lib/sleeper-cache";
import type { PlayersPayload } from "@/lib/players-build";
import { sleeperFetchJson } from "@/lib/sleeper-http";

const SLEEPER = "https://api.sleeper.app/v1";
const ACTIVITY_TTL_MS = 5 * 60 * 1000;
const CATALOG_KEY = "players-v3";

type SleeperTxn = {
  transaction_id?: string;
  type?: string;
  status?: string;
  status_updated?: number;
  created?: number;
  roster_ids?: number[];
  adds?: Record<string, number> | null;
  drops?: Record<string, number> | null;
  metadata?: { to_slot?: string; from_slot?: string; is_draft?: boolean; [key: string]: unknown } | null;
};

async function sleeperJson<T>(url: string): Promise<T | null> {
  return sleeperFetchJson<T>(url, "warm");
}

export function canFetchActivityClient(platform: string, leagueId: string): boolean {
  return (
    String(platform ?? "")
      .trim()
      .toLowerCase() === "sleeper" && /^\d{6,}$/.test(String(leagueId ?? "").trim())
  );
}

async function playerNameMap(): Promise<Map<string, { name: string; pos: string | null; team: string | null }>> {
  const hit = await readCache<PlayersPayload>(CATALOG_KEY);
  const map = new Map<string, { name: string; pos: string | null; team: string | null }>();
  for (const p of hit?.data?.players ?? []) {
    map.set(p.id, { name: p.name, pos: p.pos ?? null, team: p.team ?? null });
  }
  return map;
}

function chip(
  names: Map<string, { name: string; pos: string | null; team: string | null }>,
  playerId: string,
): string {
  const hit = names.get(playerId);
  if (!hit) return playerId;
  const bits = [hit.name];
  if (hit.pos) bits.push(hit.pos);
  if (hit.team) bits.push(hit.team);
  return bits.join(" ");
}

function move(
  names: Map<string, { name: string; pos: string | null; team: string | null }>,
  playerId: string,
  action: LeagueActivityMove["action"],
): LeagueActivityMove {
  const hit = names.get(playerId);
  return {
    playerId,
    name: hit?.name ?? playerId,
    pos: hit?.pos ?? "",
    team: hit?.team ?? "",
    action,
  };
}

function isDraftTxn(txn: SleeperTxn): boolean {
  if (txn.metadata?.is_draft === true) return true;
  const type = String(txn.type ?? "").toUpperCase();
  return type === "DRAFT" || type.includes("DRAFT");
}

function teamLabel(teams: Map<number, string>, rosterId: number | undefined): string {
  if (rosterId == null || !Number.isFinite(rosterId)) return "Manager Team";
  return teams.get(rosterId) ?? `Team ${rosterId}`;
}

function formatTxn(
  txn: SleeperTxn,
  teams: Map<number, string>,
  names: Map<string, { name: string; pos: string | null; team: string | null }>,
): LeagueActivityEvent[] {
  if (isDraftTxn(txn)) return [];
  const at = Number(txn.status_updated ?? txn.created ?? 0);
  if (!at) return [];

  const type = String(txn.type ?? "").toLowerCase();
  const isTrade = type === "trade";
  const isWaiver = type === "waiver";
  const isFreeAgent = type === "free_agent";
  const toSlot = String(txn.metadata?.to_slot ?? "").toUpperCase();
  const isActualIRMove =
    type === "injury" || type === "ir" || (!isWaiver && !isFreeAgent && !isTrade && toSlot === "IR");
  if (!isTrade && !isWaiver && !isFreeAgent && !isActualIRMove) return [];

  const status = String(txn.status ?? "").toLowerCase();
  const adds = Object.entries(txn.adds ?? {});
  const drops = Object.entries(txn.drops ?? {});
  const id = String(txn.transaction_id ?? `${type}-${at}-${adds.map(([p]) => p).join("-")}`);

  if (isTrade) {
    if (status && status !== "complete" && status !== "failed") return [];
    const byRoster = new Map<number, string[]>();
    const moves: LeagueActivityMove[] = [];
    const senderByPlayer = new Map(drops.map(([pid, rid]) => [pid, Number(rid)]));
    const tradedIds = new Set(adds.map(([pid]) => pid));
    for (const [playerId, rosterId] of adds) {
      const list = byRoster.get(rosterId) ?? [];
      list.push(chip(names, playerId));
      byRoster.set(rosterId, list);
      const sender = senderByPlayer.get(playerId);
      moves.push({
        ...move(names, playerId, "add"),
        fantasyTeam: teamLabel(teams, rosterId),
        ...(sender != null ? { fromFantasyTeam: teamLabel(teams, sender) } : {}),
      });
    }
    for (const [playerId, rosterId] of drops) {
      if (tradedIds.has(playerId)) continue;
      moves.push({
        ...move(names, playerId, "drop"),
        fantasyTeam: teamLabel(teams, Number(rosterId)),
      });
    }
    const parts = [...byRoster.entries()].map(
      ([rosterId, players]) => `${teamLabel(teams, rosterId)} received ${players.join(", ")}`,
    );
    if (!parts.length) return [];
    const prefix = status === "failed" ? "TRADE REJECTED" : "TRADE COMPLETED";
    return [{ id, at, kind: "trade", text: `${prefix}: ${parts.join(", ")}`, teamName: null, moves }];
  }

  if (isWaiver || isFreeAgent) {
    if (status && status !== "complete" && status !== "successful") return [];
    const kind: LeagueActivityEvent["kind"] = isWaiver ? "waiver" : "free_agent";
    const addSource = isWaiver ? "from waivers" : "as a free agent";
    const rosterIds = new Set<number>();
    for (const [, rosterId] of adds) {
      const rid = Number(rosterId);
      if (Number.isFinite(rid)) rosterIds.add(rid);
    }
    for (const [, rosterId] of drops) {
      const rid = Number(rosterId);
      if (Number.isFinite(rid)) rosterIds.add(rid);
    }
    for (const rosterId of txn.roster_ids ?? []) {
      const rid = Number(rosterId);
      if (Number.isFinite(rid)) rosterIds.add(rid);
    }

    const events: LeagueActivityEvent[] = [];
    for (const rosterId of rosterIds) {
      const rosterAdds = adds.filter(([, rid]) => Number(rid) === rosterId);
      const rosterDrops = drops.filter(([, rid]) => Number(rid) === rosterId);
      if (!rosterAdds.length && !rosterDrops.length) continue;
      const team = teamLabel(teams, rosterId);
      const addMoves = rosterAdds.map(([pid]) => move(names, pid, "add"));
      const dropMoves = rosterDrops.map(([pid]) => move(names, pid, "drop"));
      const eventId = `${id}-r${rosterId}`;
      if (rosterAdds.length && rosterDrops.length) {
        events.push({
          id: eventId,
          at,
          kind,
          text: `${team} ADDED ${rosterAdds.map(([pid]) => chip(names, pid)).join(", ")} ${addSource}, DROPPED ${rosterDrops.map(([pid]) => chip(names, pid)).join(", ")}`,
          teamName: team,
          moves: [...addMoves, ...dropMoves],
        });
      } else if (rosterAdds.length) {
        events.push({
          id: eventId,
          at,
          kind,
          text: `${team} ADDED ${rosterAdds.map(([pid]) => chip(names, pid)).join(", ")} ${addSource}`,
          teamName: team,
          moves: addMoves,
        });
      } else if (rosterDrops.length) {
        events.push({
          id: eventId,
          at,
          kind,
          text: `${team} DROPPED ${rosterDrops.map(([pid]) => chip(names, pid)).join(", ")}`,
          teamName: team,
          moves: dropMoves,
        });
      }
    }
    return events;
  }

  if (isActualIRMove) {
    if (status && status !== "complete" && status !== "successful") return [];
    const primaryRoster = adds[0]?.[1] ?? drops[0]?.[1] ?? txn.roster_ids?.[0];
    const team = teamLabel(teams, primaryRoster);
    const irPlayers = adds.length ? adds : drops;
    if (!irPlayers.length) return [];
    return [
      {
        id,
        at,
        kind: "ir",
        text: `${team} PLACED ${irPlayers.map(([pid]) => chip(names, pid)).join(", ")} on Injured Reserve`,
        teamName: team,
        moves: irPlayers.map(([pid]) => move(names, pid, "ir")),
      },
    ];
  }
  return [];
}

async function loadLog(leagueId: string, scope: "recent" | "season"): Promise<LeagueTransactionLog> {
  const empty: LeagueTransactionLog = { events: [], teams: [], currentWeek: 1 };
  const clean = String(leagueId ?? "").trim();
  if (!/^\d{6,}$/.test(clean)) return empty;

  return getCached(`sleeper-activity-${scope}-v1:${clean}`, ACTIVITY_TTL_MS, async () => {
    const state = await sleeperJson<{ week?: number }>(`${SLEEPER}/state/nfl`);
    const week = Math.max(1, Number(state?.week ?? 1) || 1);
    const weekCount = scope === "season" ? week : Math.min(week, 4);
    const weeks = Array.from({ length: weekCount }, (_, i) => week - i).filter((w) => w >= 1);

    const [rosters, users, names, ...weekTxnLists] = await Promise.all([
      sleeperJson<{ roster_id: number; owner_id: string | null }[]>(`${SLEEPER}/league/${clean}/rosters`),
      sleeperJson<{ user_id: string; display_name: string; metadata?: { team_name?: string } }[]>(
        `${SLEEPER}/league/${clean}/users`,
      ),
      playerNameMap(),
      ...weeks.map((w) => sleeperJson<SleeperTxn[]>(`${SLEEPER}/league/${clean}/transactions/${w}`)),
    ]);

    const byUser = new Map((users ?? []).map((u) => [u.user_id, u]));
    const teamMap = new Map<number, string>();
    for (const r of rosters ?? []) {
      const u = r.owner_id ? byUser.get(r.owner_id) : undefined;
      teamMap.set(
        r.roster_id,
        u?.metadata?.team_name?.trim() || u?.display_name || `Team ${r.roster_id}`,
      );
    }

    const events: LeagueActivityEvent[] = [];
    const seen = new Set<string>();
    weekTxnLists.forEach((list, i) => {
      for (const txn of list ?? []) {
        for (const event of formatTxn(txn, teamMap, names)) {
          if (seen.has(event.id)) continue;
          seen.add(event.id);
          events.push({ ...event, week: weeks[i]! });
        }
      }
    });
    events.sort((a, b) => b.at - a.at);
    return { events, teams: [...teamMap.values()], currentWeek: week };
  });
}

export async function fetchSleeperActivityClient(leagueId: string): Promise<LeagueActivityEvent[]> {
  const log = await loadLog(leagueId, "recent");
  return log.events.slice(0, 80);
}

export async function fetchSleeperTransactionLogClient(leagueId: string): Promise<LeagueTransactionLog> {
  return loadLog(leagueId, "season");
}
