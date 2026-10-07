/**
 * Browser → Sleeper public league settings (playoffs, waivers, roster slots).
 * Prefer over Fluid getConnectionSettings for dashboard / My Team analytics.
 */

import {
  emptyRoster,
  type DraftOrderEntry,
  type LeagueSettingsDetail,
  type RosterSlotKey,
} from "@/lib/league-settings";
import { getCached } from "@/lib/sleeper-cache";
import { sleeperFetchJson } from "@/lib/sleeper-http";

const SLEEPER = "https://api.sleeper.app/v1";
const SETTINGS_TTL_MS = 30 * 60 * 1000;

const SLEEPER_SLOT: Record<string, RosterSlotKey> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  FLEX: "FLEX",
  WRRB_FLEX: "WRRB",
  REC_FLEX: "WRTE",
  SUPER_FLEX: "SFLEX",
  K: "K",
  DEF: "DEF",
  BN: "BN",
};

const SLEEPER_STATUS: Record<string, string> = {
  pre_draft: "Pre-Draft",
  drafting: "Drafting",
  in_season: "In Season",
  post_season: "Playoffs",
  complete: "Complete",
};

function sleeperAvatar(id: string | null | undefined): string | null {
  const clean = id?.trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  if (clean === "0" || lower === "default" || lower === "null" || lower === "none") return null;
  return `https://sleepercdn.com/avatars/thumbs/${clean}`;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function titleCase(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

async function sleeperJson<T>(url: string): Promise<T | null> {
  return sleeperFetchJson<T>(url, "warm");
}

function emptyDetail(): LeagueSettingsDetail {
  return {
    platform: "sleeper",
    hostLeagueId: null,
    leagueName: null,
    teamName: null,
    avatar: null,
    season: null,
    status: null,
    leagueType: null,
    teams: null,
    playoffTeams: null,
    playoffStartWeek: null,
    waiverType: null,
    waiverBudget: null,
    tradeDeadlineWeek: null,
    tradeDeadlineDate: null,
    waiverPeriodDays: null,
    waiverOrder: [],
    tradeReviewDays: null,
    maxTrades: null,
    tradeReviewType: null,
    roster: emptyRoster(),
    scoring: {},
    draft: { type: null, status: null, rounds: null, position: null, date: null, budget: null, order: [] },
  };
}

export function canFetchSettingsClient(platform: string, leagueId: string): boolean {
  return (
    String(platform ?? "")
      .trim()
      .toLowerCase() === "sleeper" && /^\d{6,}$/.test(String(leagueId ?? "").trim())
  );
}

type CachedSettings = Omit<LeagueSettingsDetail, "teamName" | "avatar" | "waiverOrder" | "draft"> & {
  users: { user_id: string; display_name: string; avatar: string | null; team_name: string | null; meta_avatar: string | null }[];
  rosters: { roster_id: number; owner_id: string | null; waiver_position: number | null }[];
  draft: LeagueSettingsDetail["draft"];
  leagueAvatar: string | null;
};

function stampMine(board: CachedSettings, teamNameHint?: string | null): LeagueSettingsDetail {
  const hint = (teamNameHint ?? "").trim().toLowerCase();
  const userById = new Map(board.users.map((u) => [u.user_id, u]));
  const teamLabel = (u: (typeof board.users)[0] | undefined, fallback: string) =>
    u?.team_name?.trim() || u?.display_name || fallback;

  const me =
    (hint &&
      (board.users.find((u) => {
        const team = (u.team_name ?? "").toLowerCase();
        const owner = (u.display_name ?? "").toLowerCase();
        return (team && team === hint) || (owner && owner === hint);
      }) ??
        board.users.find((u) => {
          const team = (u.team_name ?? "").toLowerCase();
          const owner = (u.display_name ?? "").toLowerCase();
          return (
            (team && (team.includes(hint) || hint.includes(team))) ||
            (owner && (owner.includes(hint) || hint.includes(owner)))
          );
        }))) ||
    null;

  const myUserId = me?.user_id ?? null;
  const metaAvatar = me?.meta_avatar?.trim() || null;

  const waiverOrder = board.rosters
    .map((r) => {
      const priority = r.waiver_position;
      const u = r.owner_id ? userById.get(r.owner_id) : undefined;
      return priority
        ? {
            priority,
            team: teamLabel(u, `Team ${r.roster_id}`),
            isMine: Boolean(myUserId && r.owner_id === myUserId),
          }
        : null;
    })
    .filter((r): r is { priority: number; team: string; isMine: boolean } => r != null)
    .sort((a, b) => a.priority - b.priority);

  const draftOrder: DraftOrderEntry[] = board.draft.order.map((o) => ({
    ...o,
    isMine: Boolean(
      myUserId &&
        board.users.some(
          (u) =>
            u.user_id === myUserId &&
            (u.team_name === o.team || u.display_name === o.team),
        ),
    ),
  }));

  return {
    platform: board.platform,
    hostLeagueId: board.hostLeagueId,
    leagueName: board.leagueName,
    teamName: me ? teamLabel(me, "") || null : null,
    avatar:
      (metaAvatar && (metaAvatar.startsWith("http") ? metaAvatar : sleeperAvatar(metaAvatar))) ||
      sleeperAvatar(me?.avatar) ||
      board.leagueAvatar,
    season: board.season,
    status: board.status,
    leagueType: board.leagueType,
    teams: board.teams,
    playoffTeams: board.playoffTeams,
    playoffStartWeek: board.playoffStartWeek,
    waiverType: board.waiverType,
    waiverBudget: board.waiverBudget,
    tradeDeadlineWeek: board.tradeDeadlineWeek,
    tradeDeadlineDate: board.tradeDeadlineDate,
    waiverPeriodDays: board.waiverPeriodDays,
    waiverOrder,
    tradeReviewDays: board.tradeReviewDays,
    maxTrades: board.maxTrades,
    tradeReviewType: board.tradeReviewType,
    roster: board.roster,
    scoring: board.scoring,
    draft: {
      ...board.draft,
      order: draftOrder,
      position: board.draft.position ?? draftOrder.find((o) => o.isMine)?.pick ?? null,
    },
  };
}

export async function fetchSleeperSettingsClient(
  leagueId: string,
  teamNameHint?: string | null,
): Promise<LeagueSettingsDetail | null> {
  const clean = String(leagueId ?? "").trim();
  if (!/^\d{6,}$/.test(clean)) return null;

  const board = await getCached<CachedSettings | { empty: true }>(
    `sleeper-settings-v1:${clean}`,
    SETTINGS_TTL_MS,
    async () => {
      const [league, users, rosters] = await Promise.all([
        sleeperJson<{
          league_id: string;
          name?: string;
          season?: string;
          status?: string;
          avatar?: string | null;
          total_rosters?: number;
          draft_id?: string | null;
          roster_positions?: string[];
          scoring_settings?: Record<string, unknown>;
          settings?: Record<string, unknown>;
        }>(`${SLEEPER}/league/${clean}`),
        sleeperJson<
          {
            user_id: string;
            display_name: string;
            avatar: string | null;
            metadata?: { team_name?: string; avatar?: string };
          }[]
        >(`${SLEEPER}/league/${clean}/users`),
        sleeperJson<{ roster_id: number; owner_id: string | null; settings?: { waiver_position?: number } }[]>(
          `${SLEEPER}/league/${clean}/rosters`,
        ),
      ]);
      if (!league) return { empty: true as const };

      const draft = league.draft_id
        ? await sleeperJson<{
            type?: string;
            status?: string;
            start_time?: number | null;
            settings?: { rounds?: number; budget?: number };
            draft_order?: Record<string, number> | null;
            slot_to_roster_id?: Record<string, number> | null;
          }>(`${SLEEPER}/draft/${league.draft_id}`)
        : null;

      const s = league.settings ?? {};
      const userById = new Map((users ?? []).map((u) => [u.user_id, u]));
      const teamLabel = (
        u: { display_name: string; metadata?: { team_name?: string } } | undefined,
        fallback: string,
      ) => u?.metadata?.team_name?.trim() || u?.display_name || fallback;

      const type = num(s["type"]);
      const bestBall = num(s["best_ball"]) === 1;
      const baseType = type === 2 ? "Dynasty" : type === 1 ? "Keeper" : "Redraft";
      const waiver = num(s["waiver_type"]);
      const deadline = num(s["trade_deadline"]);

      const roster = emptyRoster();
      for (const pos of league.roster_positions ?? []) {
        const key = SLEEPER_SLOT[String(pos).toUpperCase()];
        if (key) roster[key] += 1;
      }
      roster.IR = num(s["reserve_slots"]) ?? 0;
      roster.TAXI = num(s["taxi_slots"]) ?? 0;

      const scoring: Record<string, number> = {};
      for (const [k, v] of Object.entries(league.scoring_settings ?? {})) {
        const n = num(v);
        if (n != null) scoring[k] = n;
      }

      const draftOut: LeagueSettingsDetail["draft"] = {
        type: null,
        status: null,
        rounds: null,
        position: null,
        date: null,
        budget: null,
        order: [],
      };
      if (draft) {
        draftOut.type = titleCase(draft.type ?? null);
        draftOut.status = draft.status ? (SLEEPER_STATUS[draft.status] ?? titleCase(draft.status)) : null;
        draftOut.rounds = num(draft.settings?.rounds);
        draftOut.date = draft.start_time ? Number(draft.start_time) : null;
        draftOut.budget = draft.type === "auction" ? num(draft.settings?.budget) : null;
        const ownerByRoster = new Map((rosters ?? []).map((r) => [r.roster_id, r.owner_id]));
        const order: DraftOrderEntry[] = [];
        if (draft.slot_to_roster_id && Object.keys(draft.slot_to_roster_id).length) {
          for (const [slot, rosterId] of Object.entries(draft.slot_to_roster_id)) {
            const ownerId = ownerByRoster.get(Number(rosterId)) ?? null;
            const u = ownerId ? userById.get(ownerId) : undefined;
            order.push({ pick: Number(slot), team: teamLabel(u, `Team ${rosterId}`), isMine: false });
          }
        } else if (draft.draft_order) {
          for (const [uid, slot] of Object.entries(draft.draft_order)) {
            order.push({
              pick: Number(slot),
              team: teamLabel(userById.get(uid), `Slot ${slot}`),
              isMine: false,
            });
          }
        }
        order.sort((a, b) => a.pick - b.pick);
        draftOut.order = order;
      }

      return {
        platform: "sleeper",
        hostLeagueId: clean,
        leagueName: league.name ?? null,
        season: league.season ?? null,
        status: league.status ? (SLEEPER_STATUS[league.status] ?? titleCase(league.status)) : null,
        leagueType: bestBall ? `Best Ball ${baseType}` : baseType,
        teams: league.total_rosters ?? num(s["num_teams"]),
        playoffTeams: num(s["playoff_teams"]),
        playoffStartWeek: num(s["playoff_week_start"]),
        waiverType: waiver === 2 ? "FAAB" : waiver === 1 ? "Reverse Standings" : "Rolling",
        waiverBudget: waiver === 2 ? num(s["waiver_budget"]) : null,
        tradeDeadlineWeek: deadline && deadline < 99 ? deadline : null,
        tradeDeadlineDate: null,
        waiverPeriodDays: num(s["waiver_clear_days"]),
        tradeReviewDays: num(s["trade_review_days"]),
        maxTrades: null,
        tradeReviewType: null,
        roster,
        scoring,
        draft: draftOut,
        leagueAvatar: sleeperAvatar(league.avatar),
        users: (users ?? []).map((u) => ({
          user_id: u.user_id,
          display_name: u.display_name,
          avatar: u.avatar,
          team_name: u.metadata?.team_name?.trim() || null,
          meta_avatar: u.metadata?.avatar?.trim() || null,
        })),
        rosters: (rosters ?? []).map((r) => ({
          roster_id: r.roster_id,
          owner_id: r.owner_id,
          waiver_position: num(r.settings?.waiver_position),
        })),
      } satisfies CachedSettings;
    },
  );

  if ("empty" in board) return emptyDetail();
  return stampMine(board, teamNameHint);
}
