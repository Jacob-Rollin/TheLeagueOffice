import { useCallback, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Crosshair, Settings, Timer, X } from "lucide-react";

import { MockRecap } from "@/components/draft/MockRecap";
import { PlayerModalHost, type PlayerModalHandle } from "@/components/draft/PlayerModalHost";
import { formatClock, useMockDraftSession } from "@/hooks/useMockDraftSession";
import { SCORING_LABEL, teamName } from "@/lib/draft";
import {
  clearMockSession,
  DEFAULT_MOCK_CONFIG,
  loadMockConfig,
  saveMockConfig,
  type MockConfig,
} from "@/lib/mock-config";
import { cn } from "@/lib/utils";

import { MobileMockDraftBoard } from "./MobileMockDraftBoard";
import { MobileMockDraftMenu } from "./MobileMockDraftMenu";
import { MobileMockDraftSetupForm } from "./MobileMockDraftSetupForm";
import { MobileMockDraftSheet } from "./MobileMockDraftSheet";

export function MobileMockDraftArena() {
  const navigate = useNavigate();
  const modalRef = useRef<PlayerModalHandle>(null);
  const [jumpSignal, setJumpSignal] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<MockConfig>(DEFAULT_MOCK_CONFIG);
  const [showRecap, setShowRecap] = useState(false);

  const goSetup = useCallback(() => {
    void navigate({ to: "/m/mock-draft/setup" });
  }, [navigate]);

  const session = useMockDraftSession({ onMissingConfig: goSetup });
  const {
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
    mySlotLabel,
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
    clearSession,
    myCounts,
    nextUserOverall,
    speed,
    setSpeed,
    runAiPick,
  } = session;

  const openPlayer = useCallback((id: string) => modalRef.current?.open(id), []);

  const leaveToHome = () => {
    clearSession();
    void navigate({ to: "/m" });
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
      picks.length > 0 &&
      !window.confirm("Saving settings restarts this mock with the new configuration. Continue?")
    ) {
      return;
    }
    clearMockSession();
    saveMockConfig(clean);
    setSettingsOpen(false);
    window.location.assign("/m/mock-draft");
  };

  if (!started) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-6 text-center font-display text-sm font-semibold uppercase tracking-widest text-m-muted">
        Loading mock draft…
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
              void navigate({ to: "/m/mock-draft/setup" });
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

  return (
    <div className="fixed inset-0 z-40 mx-auto flex max-w-md flex-col bg-m-bg text-m-card-fg">
      <header
        className="shrink-0 border-b border-m-border px-2 pb-2"
        style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
      >
        <div className="relative flex items-start justify-between">
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

          <div className="absolute left-1/2 top-0 flex -translate-x-1/2 flex-col items-center">
            <span
              className={cn(
                "rounded-full px-4 py-1.5 font-display text-xs font-extrabold uppercase tracking-wider",
                complete || myTurn
                  ? "bg-m-accent text-m-accent-fg"
                  : "bg-m-chip text-m-chip-fg",
              )}
            >
              {complete
                ? "Draft Complete!"
                : paused
                  ? "Paused"
                  : myTurn
                    ? "Your Turn"
                    : "On the Clock"}
            </span>
            {complete ? (
              <span className="mt-1 text-[11px] font-semibold text-m-muted">
                {settings.teams}-team {SCORING_LABEL[settings.scoring]}{" "}
                {settings.snake ? "Snake" : "Linear"}
              </span>
            ) : (
              <>
                <span
                  className={cn(
                    "mt-1 inline-flex items-center gap-1 font-display text-sm tabular-nums",
                    myTurn && clock !== null && clock <= 10 && !paused
                      ? "text-red-500"
                      : "text-m-card-fg",
                  )}
                >
                  <Timer className="size-3.5" strokeWidth={2.5} />
                  {formatClock(clock)}
                </span>
                {!myTurn ? (
                  <span className="mt-0.5 text-[10px] uppercase tracking-wider text-m-muted">
                    {teamName(settings, session.onTheClock)} · Pick {mySlotLabel}
                  </span>
                ) : null}
              </>
            )}
          </div>

          <div className="flex items-center gap-1">
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

        {!complete ? (
          <div className="mt-2 flex items-center justify-center gap-1">
            {(
              [
                ["normal", "Normal"],
                ["fast", "Fast"],
                ["manual", "Manual"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSpeed(key)}
                className={cn(
                  "rounded-full px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-wide",
                  speed === key
                    ? "bg-m-accent text-m-accent-fg"
                    : "bg-m-chip text-m-chip-fg",
                )}
              >
                {label}
              </button>
            ))}
            {speed === "manual" && !myTurn ? (
              <button
                type="button"
                onClick={runAiPick}
                className="rounded-full bg-m-cta px-2.5 py-1 font-display text-[10px] font-bold uppercase text-m-cta-fg"
              >
                Advance
              </button>
            ) : null}
          </div>
        ) : (
          <div className="mt-2 flex justify-center">
            <button
              type="button"
              onClick={() => setShowRecap(true)}
              className="rounded-full bg-m-accent px-4 py-1.5 font-display text-[11px] font-bold uppercase tracking-wide text-m-accent-fg"
            >
              View Recap
            </button>
          </div>
        )}
      </header>

      {syncing ? (
        <div className="flex flex-1 items-center justify-center text-sm text-m-muted">
          Syncing players…
        </div>
      ) : (
        <MobileMockDraftBoard
          settings={settings}
          picks={picks}
          byId={byId}
          currentOverall={currentOverall}
          myTurn={myTurn}
          complete={complete}
          jumpSignal={jumpSignal}
        />
      )}

      <MobileMockDraftSheet
        tab={tab}
        onTabChange={setTab}
        settings={settings}
        available={available}
        queuedPlayers={queuedPlayers}
        watchIds={watchIds}
        draftedIds={draftedIds}
        picks={picks}
        byId={byId}
        myTurn={myTurn}
        complete={complete}
        myCounts={myCounts}
        currentOverall={currentOverall}
        nextUserOverall={nextUserOverall}
        queueAutopickOn={queueAutopickOn}
        onQueueAutopickChange={setQueueAutopickOn}
        rosterTeam={rosterTeam}
        onRosterTeamChange={setRosterTeam}
        onDraft={draftForUser}
        onToggleQueue={toggleWatch}
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

      <PlayerModalHost
        ref={modalRef}
        showDraftActions
        resolveDraftRosterLabel={(playerId) => {
          const pick = picks.find((p) => p.playerId === playerId);
          return pick ? teamName(settings, pick.team) : null;
        }}
        isSessionDrafted={(playerId) => draftedIds.has(playerId)}
        onSessionDraft={draftForUser}
      />
    </div>
  );
}
