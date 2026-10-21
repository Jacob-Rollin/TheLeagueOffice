import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { PlayerAvatar } from "@/components/draft/PlayerAvatar";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import {
  playbookCardClass,
  playbookPanelTitleClass,
  resolveAvatarUrl,
} from "@/components/playbook/panels";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { useActiveMatchups } from "@/hooks/useActiveMatchups";
import { useActiveStandings } from "@/hooks/useActiveStandings";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useLeagueActivity } from "@/hooks/useLeagueActivity";
import { useNflState } from "@/hooks/useLeagueProjections";
import { useLeagueRosters } from "@/hooks/useLeagueRosters";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Pos } from "@/lib/draft";
import { completedWeekNumberList, standingsGamesPlayed } from "@/lib/completed-weeks";
import {
  adminRegeneratePressRoomArticle,
  loadPressRoomArticle,
} from "@/lib/press-room-articles-client";
import {
  buildPressRoomFactPack,
  pressRoomLeagueKey,
} from "@/lib/press-room-fact-pack";
import {
  generateTemplateArticle,
  type PressRoomArticleKind,
} from "@/lib/press-room-templates";
import { cn } from "@/lib/utils";
import {
  buildPlayersByName,
  buildWeekReport,
  type AwardRow,
} from "@/lib/weekly-awards";

export const Route = createFileRoute("/playbook/press-room")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Press Room — Playbook" }],
  }),
  component: PressRoomPage,
});

type ArticleTab = PressRoomArticleKind;

const ARTICLE_TABS: { id: ArticleTab; label: string }[] = [
  { id: "recap", label: "Post-Week Recap" },
  { id: "preview", label: "Matchup Preview" },
  { id: "waiver", label: "Waiver Sweep" },
];

function renderSentence(
  sentence: string,
  onOpenPlayer?: (id: string) => void,
): ReactNode {
  const normalized = sentence.replace(/\*\*([^*]+)\*\*/g, "«$1»");
  const parts = normalized
    .split(/(«[^»]+»|‹[^›]+›|⟦[^⟧]+⟧)/g)
    .filter((part) => part.length > 0);
  return parts.map((part, index) => {
    if (part.startsWith("«") && part.endsWith("»")) {
      return (
        <span key={index} className="font-mono font-black text-slate-900">
          {part.slice(1, -1)}
        </span>
      );
    }
    if (part.startsWith("‹") && part.endsWith("›")) {
      return (
        <span key={index} className="font-black text-slate-900">
          {part.slice(1, -1)}
        </span>
      );
    }
    if (part.startsWith("⟦") && part.endsWith("⟧")) {
      const inner = part.slice(1, -1);
      const sep = inner.indexOf("¦");
      const id = sep >= 0 ? inner.slice(0, sep) : "";
      const label = sep >= 0 ? inner.slice(sep + 1) : inner;
      if (id && onOpenPlayer) {
        return (
          <button
            key={index}
            type="button"
            onClick={() => onOpenPlayer(id)}
            className="cursor-pointer font-black text-slate-900 transition-colors hover:text-blue-600 hover:underline focus:outline-none"
          >
            {label}
          </button>
        );
      }
      return (
        <span key={index} className="font-black text-slate-900">
          {label}
        </span>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

function fantasyBrandColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue} 58% 38%)`;
}

const ARTICLE_BG_RECAP =
  "https://images.unsplash.com/photo-1459865264687-595d652de67e?auto=format&fit=crop&w=1800&q=80";
const ARTICLE_BG_PREVIEW = "/football-yard-line.jpg";
const ARTICLE_BG_WAIVER = "/locker-room.jpg";

function getArticleBackgroundImage(tab: ArticleTab): string {
  if (tab === "preview") return ARTICLE_BG_PREVIEW;
  if (tab === "waiver") return ARTICLE_BG_WAIVER;
  return ARTICLE_BG_RECAP;
}

function teamInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return "TM";
  const letters = cleaned.replace(/[^a-zA-Z0-9]/g, "");
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function PressRoomTeamAvatar({
  name,
  logo,
  platform,
}: {
  name: string;
  logo?: string | null;
  platform?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const src = resolveAvatarUrl(logo, { teamName: name });
  const plat = (platform ?? "").trim().toLowerCase();

  useEffect(() => {
    setFailed(false);
  }, [src, plat, name]);

  const shell =
    "relative flex h-14 w-14 flex-shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm";

  if (src && !failed) {
    return (
      <span className={shell}>
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  if (plat === "espn") {
    return (
      <span className={shell}>
        <img src="/espn.png" alt="ESPN" className="h-8 w-8 object-contain" aria-hidden="true" />
      </span>
    );
  }

  return <span className={shell}>{teamInitials(name)}</span>;
}

function AwardCard({
  award,
  platform,
  onOpenPlayer,
  onOpenTeam,
}: {
  award: AwardRow;
  platform: string | null;
  onOpenPlayer: (id: string) => void;
  onOpenTeam: (rosterId: number) => void;
}) {
  const openLead = () => {
    if (award.playerId) {
      onOpenPlayer(award.playerId);
      return;
    }
    if (award.rosterId != null) onOpenTeam(award.rosterId);
  };

  return (
    <div className="flex items-center space-x-4 rounded-xl border border-slate-100 bg-white p-4 text-left shadow-sm">
      {award.player ? (
        <button
          type="button"
          className="relative h-14 w-14 flex-shrink-0 cursor-pointer select-none overflow-hidden rounded-full border border-slate-200 bg-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          onClick={() => onOpenPlayer(award.player!.id)}
          aria-label={`Open ${award.player.name}`}
        >
          <PlayerAvatar
            id={award.player.id}
            pos={(award.player.pos || "WR") as Pos}
            team={award.player.team || ""}
            name={award.player.name}
            className="size-14"
            logoClassName="size-5"
          />
        </button>
      ) : (
        <button
          type="button"
          className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          onClick={openLead}
          aria-label={`Open ${award.teamName}`}
        >
          <PressRoomTeamAvatar name={award.teamName} logo={award.logo} platform={platform} />
        </button>
      )}
      <div className="min-w-0 flex-1 select-none pr-4 text-left">
        <span className="mb-2 block text-left text-xs font-black uppercase tracking-widest text-slate-900">
          {award.title}
        </span>
        <p className="text-left text-sm font-bold leading-relaxed text-slate-600">
          <button
            type="button"
            onClick={openLead}
            className="mr-1.5 cursor-pointer font-black text-slate-900 transition-colors hover:text-blue-600 hover:underline"
          >
            {award.leadName}
          </button>
          {renderSentence(award.sentence)}
        </p>
      </div>
    </div>
  );
}

function PressRoomPage() {
  const { activeLeague, sandboxMode } = useActiveLeague();
  const { user } = useAuth();
  const { data: isAdmin } = useIsAdmin(user?.id ?? null);
  const queryClient = useQueryClient();
  const platform = activeLeague?.platform ?? null;
  const { data: playersPayload } = useSleeperPlayers();
  const players = playersPayload?.players ?? [];
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const playersByName = useMemo(() => buildPlayersByName(players), [players]);
  const { teams, rosterPositions } = useLeagueRosters(players);
  const { standings } = useActiveStandings();
  const { events } = useLeagueActivity();
  const modalRef = useRef<PlayerModalHandle>(null);

  const nflWeek = useNflState();
  const currentWeek = nflWeek.data?.week ?? null;
  const displayWeek = nflWeek.data?.displayWeek ?? null;
  const seasonYear = Number(nflWeek.data?.season) || new Date().getUTCFullYear();
  const finalizedWeeks = useMemo(() => {
    const weeks = completedWeekNumberList({
      nflWeek: currentWeek,
      displayWeek,
      gamesPlayed: standingsGamesPlayed(standings?.rows),
    });
    return weeks.length ? weeks : [1];
  }, [currentWeek, displayWeek, standings?.rows]);

  const defaultWeek = finalizedWeeks[finalizedWeeks.length - 1] ?? 1;
  const [selectedWeek, setSelectedWeek] = useState<number>(defaultWeek);
  const [articleTab, setArticleTab] = useState<ArticleTab>("recap");
  const [regenError, setRegenError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedWeek(defaultWeek);
  }, [defaultWeek, activeLeague?.id]);

  const { matchups, loading: matchupsLoading } = useActiveMatchups(selectedWeek);
  const { matchups: previewMatchups } = useActiveMatchups(selectedWeek + 1);

  const weekReport = useMemo(
    () =>
      buildWeekReport({
        week: selectedWeek,
        entries: matchups?.entries ?? [],
        previewEntries: previewMatchups?.entries ?? [],
        playersById,
        playersByName,
        rosterPositions,
        events,
        teams,
      }),
    [matchups, previewMatchups, playersById, playersByName, rosterPositions, events, selectedWeek, teams],
  );

  const leagueKey = useMemo(() => {
    if (sandboxMode || !activeLeague) return null;
    return pressRoomLeagueKey({
      platform: activeLeague.platform,
      leagueId: activeLeague.leagueId,
      ...(activeLeague.nativeLeagueId ? { nativeLeagueId: activeLeague.nativeLeagueId } : {}),
      season: seasonYear,
    });
  }, [activeLeague, sandboxMode, seasonYear]);

  const templateArticle = useMemo(
    () => generateTemplateArticle(articleTab, weekReport.brief),
    [articleTab, weekReport.brief],
  );

  const factPack = useMemo(() => {
    if (!leagueKey || !weekReport.brief.apexTeam) return null;
    return buildPressRoomFactPack({
      brief: weekReport.brief,
      kind: articleTab,
      leagueKey,
      season: seasonYear,
      entries: matchups?.entries ?? [],
      standingsRows: standings?.rows ?? null,
      events,
      playersById,
      playersByName,
    });
  }, [
    leagueKey,
    weekReport.brief,
    articleTab,
    seasonYear,
    matchups?.entries,
    standings?.rows,
    events,
    playersById,
    playersByName,
  ]);

  const articleQueryKey = [
    "press-room-article",
    leagueKey ?? "none",
    selectedWeek,
    articleTab,
  ] as const;

  const articleQuery = useQuery({
    queryKey: articleQueryKey,
    enabled: Boolean(factPack),
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      if (!factPack) return templateArticle;
      try {
        return await loadPressRoomArticle({ factPack });
      } catch (error) {
        console.warn("[press-room] load failed; using template", error);
        return { ...templateArticle, source: "template" as const, model: "template", factHash: "", leagueKey: leagueKey ?? "", week: selectedWeek, kind: articleTab };
      }
    },
  });

  const regenerate = useMutation({
    mutationFn: async () => {
      if (!factPack) throw new Error("No fact pack for this week.");
      return adminRegeneratePressRoomArticle({ factPack });
    },
    onMutate: () => setRegenError(null),
    onSuccess: (article) => {
      queryClient.setQueryData(articleQueryKey, article);
    },
    onError: (error) => {
      setRegenError(error instanceof Error ? error.message : "Regenerate failed.");
    },
  });

  const activeArticle = articleQuery.data ?? templateArticle;

  const navigate = useNavigate();
  const openPlayer = (id: string) => modalRef.current?.open(id);
  const openTeam = (rosterId: number) => {
    void navigate({
      to: "/playbook/rosters",
      search: { scout: String(rosterId) },
    });
  };

  const articleBackgroundSrc = getArticleBackgroundImage(articleTab);

  const bannerTeamName =
    articleTab === "preview"
      ? weekReport.brief.previewFocusTeam || weekReport.brief.apexTeam
      : articleTab === "waiver"
        ? weekReport.brief.waiverTeam || weekReport.brief.apexTeam
        : weekReport.brief.apexTeam;
  const bannerLogoRaw =
    articleTab === "preview"
      ? weekReport.brief.previewFocusLogo || weekReport.brief.apexLogo
      : articleTab === "waiver"
        ? weekReport.brief.waiverLogo || weekReport.brief.apexLogo
        : weekReport.brief.apexLogo;
  const bannerLogoSrc = resolveAvatarUrl(bannerLogoRaw, { teamName: bannerTeamName });

  const deskEyebrow =
    articleTab === "recap"
      ? "Editorial Debrief"
      : articleTab === "preview"
        ? "Matchup Intel"
        : "Wire Scout";

  const showAdminRegen = isAdmin === true && Boolean(factPack);

  return (
    <div className="w-full">
      <div className="mb-4 flex w-full items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="display-title text-3xl">
            Press <span className="text-primary">Room</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Weekly league journalism, awards, and headline performances.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <div className="w-[11rem]">
            <Select
              value={String(selectedWeek)}
              onValueChange={(value) => setSelectedWeek(Math.max(1, Number(value) || 1))}
            >
              <SelectTrigger className="h-9 border-slate-200 bg-white text-sm font-semibold text-slate-800">
                <SelectValue placeholder="Select week" />
              </SelectTrigger>
              <SelectContent>
                {finalizedWeeks.map((week) => (
                  <SelectItem key={week} value={String(week)}>
                    Week {week}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {showAdminRegen ? (
            <button
              type="button"
              disabled={regenerate.isPending || matchupsLoading}
              onClick={() => regenerate.mutate()}
              className={cn(
                "h-9 shrink-0 rounded-md border border-blue-600 bg-transparent px-3",
                "text-sm font-medium text-blue-600 transition-colors",
                "hover:bg-blue-600 hover:text-white",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              {regenerate.isPending ? "Regenerating…" : "Regenerate"}
            </button>
          ) : null}
        </div>
      </div>
      {regenError ? (
        <p className="mb-2 text-sm text-red-600" role="alert">
          {regenError}
        </p>
      ) : null}

      <div className="mt-4 grid w-full grid-cols-1 gap-6 select-none lg:grid-cols-3">
        <div className="flex min-h-[500px] flex-col items-start rounded-2xl border border-slate-100 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="mb-5 flex w-full flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-100 pb-1">
            {ARTICLE_TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setArticleTab(item.id)}
                className={cn(
                  "shrink-0 text-xs font-black uppercase tracking-wider transition-colors",
                  articleTab === item.id
                    ? "border-b-2 border-blue-600 pb-2.5 text-blue-600"
                    : "pb-2.5 text-slate-400 hover:text-slate-700",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="group relative mb-6 h-[180px] w-full select-none overflow-hidden rounded-xl border border-slate-100/50 bg-slate-900 shadow-xs">
            <img
              src={articleBackgroundSrc}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-35 blur-[1px] transition-transform duration-700 group-hover:scale-105"
            />
            <div
              className="pointer-events-none absolute inset-0 opacity-15 mix-blend-color"
              style={{
                backgroundColor: fantasyBrandColor(bannerTeamName || "League"),
              }}
            />
            {bannerLogoSrc ? (
              <img
                src={bannerLogoSrc}
                alt=""
                className="pointer-events-none absolute right-5 top-1/2 h-24 w-24 -translate-y-1/2 rounded-full border border-white/30 object-cover opacity-90 shadow-lg"
              />
            ) : null}
            <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-slate-950 via-slate-950/40 to-slate-950/20 p-5 text-left">
              <span className="mb-1 text-[9px] font-black uppercase tracking-widest text-blue-400">
                {deskEyebrow}
              </span>
              <h2 className="max-w-2xl font-sans text-xl font-black uppercase leading-tight tracking-tight text-white drop-shadow-md">
                {activeArticle.title}
              </h2>
            </div>
          </div>

          <article className="w-full text-left">
            {matchupsLoading && !weekReport.brief.apexTeam ? (
              <p className="text-sm text-muted-foreground">Loading editorial desk…</p>
            ) : articleQuery.isFetching && !articleQuery.data ? (
              <p className="text-sm text-muted-foreground">Filing this week’s desk copy…</p>
            ) : (
              <div className="space-y-5">
                {activeArticle.paragraphs.map((paragraph, index) => (
                  <p
                    key={`${articleTab}-${index}`}
                    className="text-base font-medium leading-relaxed text-slate-600 sm:text-[1.05rem]"
                  >
                    {renderSentence(paragraph, openPlayer)}
                  </p>
                ))}
              </div>
            )}
          </article>
        </div>

        <div className="flex flex-col space-y-3 lg:col-span-1">
          <h2 className={playbookPanelTitleClass}>
            Weekly Awards
          </h2>
          {matchupsLoading && weekReport.awards.length === 0 ? (
            <div className={cn(playbookCardClass, "p-4")}>
              <p className="text-sm text-muted-foreground">Compiling awards desk…</p>
            </div>
          ) : weekReport.awards.length === 0 ? (
            <div className={cn(playbookCardClass, "p-4")}>
              <p className="text-sm text-muted-foreground">
                Awards appear once this week has completed matchup results.
              </p>
            </div>
          ) : (
            weekReport.awards.map((award) => (
              <AwardCard
                key={award.id}
                award={award}
                platform={platform}
                onOpenPlayer={openPlayer}
                onOpenTeam={openTeam}
              />
            ))
          )}
        </div>
      </div>

      <PlayerModalHost ref={modalRef} />
    </div>
  );
}
