import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";

import { useActiveLeague } from "@/context/ActiveLeagueContext";
import { useAuth } from "@/hooks/useAuth";
import { fetchConnectionSyncPreferred } from "@/lib/sleeper-sync-client";
import {
  clearMockSession,
  DEFAULT_MOCK_CONFIG,
  loadMockConfig,
  saveMockConfig,
  type MockConfig,
} from "@/lib/mock-config";

import { MobileMockDraftSetupForm } from "./MobileMockDraftSetupForm";

export function MobileMockDraftSetupPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeLeague } = useActiveLeague();
  const [config, setConfig] = useState<MockConfig>(() => loadMockConfig() ?? DEFAULT_MOCK_CONFIG);
  const [touchedName, setTouchedName] = useState(false);
  const syncedRef = useRef<MockConfig | null>(null);
  const appliedRef = useRef<string | null>(null);

  const { data: synced } = useQuery({
    queryKey: ["connection-sync", activeLeague?.id ?? null],
    enabled: Boolean(activeLeague?.leagueId),
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () =>
      fetchConnectionSyncPreferred({
        leagueId: activeLeague?.leagueId ?? "",
        platform: activeLeague?.platform ?? "sleeper",
        teamName: activeLeague?.teamName ?? activeLeague?.name,
        connectionId: activeLeague?.id,
        ...(activeLeague?.s2 ? { s2: activeLeague.s2 } : {}),
        ...(activeLeague?.swid ? { swid: activeLeague.swid } : {}),
      }),
  });

  useEffect(() => {
    const id = activeLeague?.id ?? null;
    if (!id || !synced) return;
    const teams = Number(synced?.teams) || DEFAULT_MOCK_CONFIG.teams;
    const roster = { ...DEFAULT_MOCK_CONFIG.roster, ...(synced?.roster ?? {}) };
    const slot = Math.min(Math.max(Number(synced?.myTeam) || 1, 1), teams);
    const teamName =
      activeLeague?.teamName?.trim() ||
      synced?.teamNames?.[String(slot)] ||
      DEFAULT_MOCK_CONFIG.teamName;
    const next: MockConfig = {
      ...DEFAULT_MOCK_CONFIG,
      teamName,
      teams,
      slot,
      scoring: synced?.scoring ?? DEFAULT_MOCK_CONFIG.scoring,
      snake: Boolean(synced?.snake ?? DEFAULT_MOCK_CONFIG.snake),
      roster,
      playoffsStartWeek:
        Number(synced?.playoffStartWeek) || DEFAULT_MOCK_CONFIG.playoffsStartWeek,
    };
    const signature = `${id}:${JSON.stringify(next)}`;
    if (appliedRef.current === signature) return;
    appliedRef.current = signature;
    syncedRef.current = next;
    setConfig((c) => ({ ...next, timerLabel: c.timerLabel }));
  }, [synced, activeLeague?.id, activeLeague?.teamName]);

  useEffect(() => {
    if (touchedName || syncedRef.current) return;
    const full = (user?.user_metadata as { full_name?: string } | undefined)?.full_name;
    if (full && config.teamName === DEFAULT_MOCK_CONFIG.teamName) {
      setConfig((c) => ({ ...c, teamName: full }));
    }
  }, [user, touchedName, config.teamName]);

  const begin = () => {
    const clean: MockConfig = {
      ...config,
      teamName: config.teamName.trim() || "My Team",
      slot: Math.min(Math.max(1, config.slot), config.teams),
    };
    clearMockSession();
    saveMockConfig(clean);
    void navigate({ to: "/m/mock-draft" });
  };

  return (
    <div className="fixed inset-0 z-40 mx-auto flex max-w-md flex-col bg-m-bg text-m-card-fg">
      <header
        className="flex shrink-0 items-center justify-between border-b border-m-border px-3 py-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={() => void navigate({ to: "/m" })}
          className="rounded-lg bg-m-icon-bg p-2.5 text-m-icon-fg"
        >
          <X className="size-5" strokeWidth={2.5} />
        </button>
        <h1 className="font-display text-lg font-bold">Draft Settings</h1>
        <button
          type="button"
          onClick={begin}
          className="font-display text-sm font-bold uppercase tracking-wide text-m-accent"
        >
          Save
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeLeague ? (
          <p className="border-b border-m-border px-4 py-2 text-xs text-m-muted">
            Prefilling from {activeLeague.name}
            {activeLeague.teamName ? ` · ${activeLeague.teamName}` : ""}
          </p>
        ) : null}
        <MobileMockDraftSetupForm
          config={config}
          onChange={(p) => setConfig((c) => ({ ...c, ...p }))}
          onNameTouched={() => setTouchedName(true)}
        />
      </div>

      <div
        className="shrink-0 border-t border-m-border bg-m-bg px-4 pt-3"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        <button
          type="button"
          onClick={begin}
          className="w-full rounded-xl bg-m-accent py-3.5 font-display text-base font-extrabold uppercase tracking-wide text-m-accent-fg"
        >
          Begin Mock Draft
        </button>
      </div>
    </div>
  );
}
