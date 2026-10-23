import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Crosshair, Settings, Timer, X } from "lucide-react";

import { MockRecap } from "@/components/draft/MockRecap";
import { useOpenMobilePlayer } from "@/components/mobile/MobilePlayerSheet";
import { formatClock, useMockDraftSession } from "@/hooks/useMockDraftSession";
import { SCORING_LABEL } from "@/lib/draft";
import {
  clearMockSession,
  DEFAULT_MOCK_CONFIG,
  loadMockConfig,
  loadMockSession,
  mockSessionMatchesConfig,
  saveMockConfig,
  type MockConfig,
} from "@/lib/mock-config";
import { warmMockDraftClientCaches } from "@/lib/mock-draft-warm";
import { cn } from "@/lib/utils";

import { MobileMockDraftBoard, pickLabelForOverall } from "./MobileMockDraftBoard";
import { MobileMockDraftMenu } from "./MobileMockDraftMenu";
import { MobileMockDraftSetupForm } from "./MobileMockDraftSetupForm";
import { MobileMockDraftSheet } from "./MobileMockDraftSheet";
import { posCellClass } from "./posCellStyles";

export function MobileMockDraftArena() {
  const navigate = useNavigate();
  const openPlayer = useOpenMobilePlayer();
  const [jumpSignal, setJumpSignal] = useState(0);
  const [bootKey, setBootKey] = useState(0);
  const [live, setLive] = useState(false);
  /** Lobby: AI names stay hidden until the user claims a draft slot. */
  const [slotClaimed, setSlotClaimed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<MockConfig>(DEFAULT_MOCK_CONFIG);
  const [showRecap, setShowRecap] = useState(false);
  /** Splash waits for day-cached catalog (+ board extras) like desktop. */
  const [cacheReady, setCacheReady] = useState(false);

  const seedDefaults = useCallback(() => {
    if (!loadMockConfig()) {
      saveMockConfig(DEFAULT_MOCK_CONFIG);
    }
    setBootKey((k) => k + 1);
  }, []);

  const session = useMockDraftSession({
    onMissingConfig: seedDefaults,
    bootKey,
    live,
  });
  const {
    data,
    syncing,
    config,
    started,
    settings,
    picks,
    byId,
    available,
    queuedPlayers,
    watchIds,
    draftedIds,
    myTurn,
    complete,
    currentOverall,
    clock,
    paused,
    setPaused,
    tab,
    setTab,
    rosterTeam,
    setRosterTeam,
    queueAutopickOn,
    setQueueAutopickOn,
    draftForUser,
    toggleWatch,
    moveQueued,
    removeQueued,
    clearSession,
    myCounts,
    nextUserOverall,
  } = session;

  // Warm IndexedDB Sleeper catalog + season board extras during splash so the
  // lobby never mounts an empty player sheet (getCached / rate-budgeted).
  useEffect(() => {
    let cancelled = false;
    void warmMockDraftClientCaches()
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setCacheReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Arena sits outside MobileShell — pin document rubber-band so the board
  // cannot be pulled past round 1 under the header.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overscrollBehaviorY;
    const prevBody = body.style.overscrollBehaviorY;
    html.style.overscrollBehaviorY = "none";
    body.style.overscrollBehaviorY = "none";
    return () => {
      html.style.overscrollBehaviorY = prevHtml;
      body.style.overscrollBehaviorY = prevBody;
    };
  }, []);

  // Resume an in-progress session into live mode; otherwise stay in lobby.
  useEffect(() => {
    if (!started || !config) return;
    const stored = loadMockSession();
    if (mockSessionMatchesConfig(stored, config) && (stored?.picks.length ?? 0) > 0) {
      setLive(true);
      setSlotClaimed(true);
    }
  }, [started, config, bootKey]);

  const leaveToHome = () => {
    clearSession();
    void navigate({ to: "/m" });
  };

  const claimSlot = (team: number) => {
    const base = config ?? loadMockConfig() ?? DEFAULT_MOCK_CONFIG;
    const clean: MockConfig = {
      ...base,
      slot: Math.min(Math.max(1, team), base.teams),
      teamName: base.teamName.trim() || "My Team",
    };
    clearMockSession();
    saveMockConfig(clean);
    setSlotClaimed(true);
    setBootKey((k) => k + 1);
  };

  const confirmLeave = (message: string, then: () => void) => {
    if (picks.length > 0 && !window.confirm(message)) return;
    then();
  };

  const openSettings = () => {
    setMenuOpen(false);
    setSettingsDraft(config ?? loadMockConfig() ?? DEFAULT_MOCK_CONFIG);
    setSettingsOpen(true);
  };

  const saveSettings = () => {
    const clean: MockConfig = {
      ...settingsDraft,
      teamName: settingsDraft.teamName.trim() || "My Team",
      slot: Math.min(Math.max(1, settingsDraft.slot), settingsDraft.teams),
    };
    if (
      live &&
      picks.length > 0 &&
      !window.confirm("Saving settings restarts this mock with the new configuration. Continue?")
    ) {
      return;
    }
    clearMockSession();
    saveMockConfig(clean);
    setSettingsOpen(false);
    setShowRecap(false);
    setLive(false);
    setSlotClaimed(true);
    setBootKey((k) => k + 1);
  };

  const startDraft = () => {
    if (!slotClaimed) {
      window.alert("Claim a draft slot first.");
      return;
    }
    if (!loadMockConfig()) saveMockConfig(config ?? DEFAULT_MOCK_CONFIG);
    setLive(true);
  };

  // Hold splash until config boots and the client catalog is warm — avoids the
  // lobby flashing "Syncing players…" then rebuilding the sheet.
  if (!started || !cacheReady || syncing) {
    return (
      <div
        className="fixed inset-0 z-40 mx-auto flex max-w-md flex-col items-center justify-center bg-m-bg px-6 text-center font-display text-sm font-semibold uppercase tracking-widest text-m-muted"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        {syncing || !cacheReady ? "Syncing players…" : "Loading mock draft…"}
      </div>
    );
  }

  if (showRecap) {
    return (
      <div className="fixed inset-0 z-40 mx-auto flex max-w-md flex-col bg-m-bg">
        <header
          className="flex items-center justify-between border-b border-m-border px-3 py-3 text-m-card-fg"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={leaveToHome}
            className="rounded-lg bg-m-icon-bg p-2.5 text-m-icon-fg"
          >
            <X className="size-5" strokeWidth={2.5} />
          </button>
          <h1 className="font-display text-lg font-bold">Draft Recap</h1>
          <button
            type="button"
            onClick={() => {
              clearSession();
              setLive(false);
              setSlotClaimed(false);
              setShowRecap(false);
              setBootKey((k) => k + 1);
            }}
            className="rounded-lg bg-m-accent px-3 py-2 font-display text-xs font-bold uppercase tracking-wide text-m-accent-fg"
          >
            New
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MockRecap
            settings={settings}
            picks={picks}
            byId={byId}
            playoffsStartWeek={config?.playoffsStartWeek ?? 15}
          />
        </div>
      </div>
    );
  }

  const inLobby = !live && !complete;
  const lastPick = picks.length > 0 ? picks[picks.length - 1]! : null;
  const lastPlayer = lastPick ? byId.get(lastPick.playerId) : undefined;

  return (
    <div className="fixed inset-0 z-40 mx-auto flex max-w-md flex-col overflow-hidden overscroll-none bg-m-bg text-m-card-fg">
      <header
        className="shrink-0 border-b border-m-border px-2 pb-2.5"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        {inLobby ? (
          /* Equal side rails keep Start centered in the lobby. */
          <div className="flex items-start gap-1">
            <div className="flex w-[5.75rem] shrink-0 justify-start">
              <button
                type="button"
                aria-label="Exit draft"
                onClick={() =>
                  confirmLeave("Leave this mock draft?", () => {
                    clearSession();
                    void navigate({ to: "/m" });
                  })
                }
                className="rounded-lg bg-m-icon-bg p-2.5 text-m-icon-fg"
              >
                <X className="size-5" strokeWidth={2.5} />
              </button>
            </div>
            <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5 pt-0.5">
              <button
                type="button"
                onClick={startDraft}
                disabled={!slotClaimed}
                className={cn(
                  "w-full rounded-full px-3 py-2.5 font-display text-sm font-extrabold uppercase tracking-wide",
                  slotClaimed
                    ? "bg-m-accent text-m-accent-fg"
                    : "bg-m-chip text-m-muted",
                )}
              >
                Start Mock Draft
              </button>
            </div>
            <div className="flex w-[5.75rem] shrink-0 items-center justify-end gap-1">
              <button
                type="button"
                aria-label="Draft settings"
                onClick={openSettings}
                className="rounded-lg bg-m-icon-bg p-2.5 text-m-icon-fg"
              >
                <Settings className="size-5" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        ) : (
          /*
            Live: last-pick chip sits in the gap between Exit and the clock so
            the sheet can cover the board without hiding who just went.
          */
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Exit draft"
              onClick={() =>
                confirmLeave("Leave this mock draft?", () => {
                  clearSession();
                  void navigate({ to: "/m" });
                })
              }
              className="shrink-0 rounded-lg bg-m-icon-bg p-2.5 text-m-icon-fg"
            >
              <X className="size-5" strokeWidth={2.5} />
            </button>

            <div className="min-w-0 flex-1">
              {lastPick && lastPlayer ? (
                <button
                  type="button"
                  onClick={() => openPlayer(lastPlayer.id)}
                  aria-label={`Last pick ${lastPlayer.name}`}
                  className={cn(
                    "flex w-full max-w-[9.25rem] flex-col rounded-md px-1.5 py-1 text-left",
                    posCellClass(lastPlayer.pos),
                  )}
                >
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate text-[8px] font-bold uppercase leading-none opacity-80">
                      {lastPlayer.pos === "DEF" ? "DST" : lastPlayer.pos} ·{" "}
                      {lastPlayer.team}
                    </span>
                    <span className="tabnum shrink-0 text-[8px] font-semibold leading-none opacity-70">
                      {pickLabelForOverall(lastPick.overall, settings.teams)}
                    </span>
                  </div>
                  <span className="mt-0.5 truncate text-[10px] font-extrabold leading-tight tracking-tight">
                    {shortHeaderName(lastPlayer.name)}
                  </span>
                </button>
              ) : (
                <span className="block truncate px-1 text-[10px] font-semibold uppercase tracking-wide text-m-muted">
                  Waiting for first pick
                </span>
              )}
            </div>

            <div className="flex shrink-0 flex-col items-center gap-0.5 px-0.5">
              {complete || paused || myTurn ? (
                <span
                  className={cn(
                    "rounded-full px-3 py-1 font-display text-[11px] font-extrabold uppercase tracking-wider",
                    complete || myTurn
                      ? "bg-m-accent text-m-accent-fg"
                      : "bg-m-chip text-m-chip-fg",
                  )}
                >
                  {complete ? "Done" : paused ? "Paused" : "Your Turn"}
                </span>
              ) : null}
              {!complete ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 font-display text-base font-extrabold tabular-nums tracking-wide",
                    clock !== null && clock <= 10 && !paused
                      ? "text-red-500"
                      : "text-m-card-fg",
                  )}
                >
                  <Timer className="size-4" strokeWidth={2.75} />
                  {formatClock(clock)}
                </span>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center justify-end gap-1">
              <button
                type="button"
                aria-label="Jump to current pick"
                onClick={() => setJumpSignal((n) => n + 1)}
                className="rounded-lg bg-m-icon-bg p-2.5 text-m-icon-fg"
              >
                <Crosshair className="size-5" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                aria-label="Draft menu"
                onClick={() => setMenuOpen(true)}
                className="rounded-lg bg-m-icon-bg p-2.5 text-m-icon-fg"
              >
                <Settings className="size-5" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        )}

        {!inLobby && complete ? (
          <div className="mt-2 flex flex-col items-center gap-2">
            <span className="text-[11px] font-semibold text-m-muted">
              {settings.teams}-team {SCORING_LABEL[settings.scoring]}{" "}
              {settings.snake ? "Snake" : "Linear"}
            </span>
            <button
              type="button"
              onClick={() => setShowRecap(true)}
              className="rounded-full bg-m-accent px-4 py-1.5 font-display text-[11px] font-bold uppercase tracking-wide text-m-accent-fg"
            >
              View Recap
            </button>
          </div>
        ) : null}

        {inLobby ? (
          <p className="mt-2 text-center text-[11px] text-m-muted">
            {settings.teams}-team {SCORING_LABEL[settings.scoring]} ·{" "}
            {settings.snake ? "Snake" : "Linear"}
            {slotClaimed ? ` · Slot ${settings.myTeam}` : " · Claim a slot to start"}
          </p>
        ) : null}
      </header>

      <MobileMockDraftBoard
        settings={settings}
        picks={picks}
        byId={byId}
        currentOverall={currentOverall}
        complete={complete || inLobby}
        jumpSignal={jumpSignal}
        lobby={inLobby}
        slotClaimed={slotClaimed}
        onClaimSlot={claimSlot}
        onOpenPlayer={openPlayer}
      />

      <MobileMockDraftSheet
        tab={tab}
        onTabChange={setTab}
        settings={settings}
        season={data.season}
        available={available}
        queuedPlayers={queuedPlayers}
        watchIds={watchIds}
        draftedIds={draftedIds}
        picks={picks}
        byId={byId}
        myTurn={myTurn}
        // Keep Draft buttons visible in the lobby (disabled until live); only
        // hide them when the draft itself is finished.
        complete={complete}
        myCounts={myCounts}
        currentOverall={currentOverall}
        nextUserOverall={inLobby ? null : nextUserOverall}
        queueAutopickOn={queueAutopickOn}
        onQueueAutopickChange={setQueueAutopickOn}
        rosterTeam={rosterTeam}
        onRosterTeamChange={setRosterTeam}
        onDraft={draftForUser}
        onToggleQueue={toggleWatch}
        onMoveQueued={moveQueued}
        onRemoveQueued={removeQueued}
        onOpenPlayer={openPlayer}
      />

      <MobileMockDraftMenu
        open={menuOpen}
        paused={paused}
        onClose={() => setMenuOpen(false)}
        onPauseToggle={() => {
          setPaused((p) => !p);
          setMenuOpen(false);
        }}
        onEndDraft={() => {
          setMenuOpen(false);
          if (!complete && picks.length > 0) {
            if (!window.confirm("End this draft early and view the recap?")) return;
          }
          setPaused(true);
          setShowRecap(true);
        }}
        onOpenSettings={openSettings}
        onDeleteDraft={() => {
          setMenuOpen(false);
          confirmLeave("Delete this mock draft and return home?", leaveToHome);
        }}
      />

      {settingsOpen ? (
        <div className="fixed inset-0 z-[80] mx-auto flex max-w-md flex-col bg-m-bg">
          <header
            className="flex items-center justify-between border-b border-m-border px-3 py-3"
            style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
          >
            <button
              type="button"
              aria-label="Close settings"
              onClick={() => setSettingsOpen(false)}
              className="rounded-lg bg-m-icon-bg p-2.5 text-m-icon-fg"
            >
              <X className="size-5" strokeWidth={2.5} />
            </button>
            <h1 className="font-display text-lg font-bold">Draft Settings</h1>
            <button
              type="button"
              onClick={saveSettings}
              className="font-display text-sm font-bold uppercase tracking-wide text-m-accent"
            >
              Save
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <MobileMockDraftSetupForm
              config={settingsDraft}
              onChange={(p) => setSettingsDraft((c) => ({ ...c, ...p }))}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Compact header name: "Ja'Marr Chase" → "J. Chase". */
function shortHeaderName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name;
  const first = parts[0]!;
  return `${first[0]}. ${parts.slice(1).join(" ")}`;
}
