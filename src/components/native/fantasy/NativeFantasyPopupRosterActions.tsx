import { ArrowLeftRight, Minus, Plus } from "lucide-react";
import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

import {
  useNativeRosterActions,
  type NativePlayerOwnership,
} from "@/components/mobile/league/nativeRosterActions";
import type { Player } from "@/lib/players-build";
import { cn } from "@/lib/utils";

type RosterActionsCtx = {
  player: Player;
  ownership: NativePlayerOwnership;
  busy: boolean;
  requestAdd: (p: Player) => void;
  requestDrop: (p: Player) => void;
  requestTradeAway: (p: Player) => void;
  requestTradeFor: (p: Player) => void;
};

const Ctx = createContext<RosterActionsCtx | null>(null);

/**
 * One hook + modals host for the desktop player popup. Mount once so hero and
 * compact sticky header can both render the same Add/Drop/Trade pills.
 */
export function NativeFantasyPopupRosterProvider({
  player,
  children,
}: {
  player: Player;
  children: ReactNode;
}) {
  const actions = useNativeRosterActions({ variant: "desktop" });
  if (!actions.isNative) return <>{children}</>;

  const value: RosterActionsCtx = {
    player,
    ownership: actions.ownershipFor(player.id),
    busy: actions.busy,
    requestAdd: actions.requestAdd,
    requestDrop: actions.requestDrop,
    requestTradeAway: actions.requestTradeAway,
    requestTradeFor: actions.requestTradeFor,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {actions.modals}
    </Ctx.Provider>
  );
}

/** Hover-expand Add / Drop / Trade pills — same pattern as Watch / Compare. */
export function NativeFantasyPopupRosterButtons({
  className,
}: {
  className?: string;
}) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;

  const { player, ownership, busy } = ctx;

  const pill =
    "group inline-flex max-w-[38px] shrink-0 cursor-pointer select-none items-center overflow-hidden whitespace-nowrap rounded-full border px-2.5 py-1.5 transition-all duration-300 hover:max-w-[120px] disabled:cursor-not-allowed disabled:opacity-50";

  const label =
    "ml-1.5 text-[10px] font-black uppercase tracking-wider text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100";

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {ownership === "fa" ? (
        <button
          type="button"
          disabled={busy}
          aria-label={`Add ${player.name}`}
          onClick={() => ctx.requestAdd(player)}
          className={cn(
            pill,
            "border-[#1fae5b]/70 bg-[#1fae5b] text-white hover:max-w-[100px] hover:bg-[#1a9a50]",
          )}
        >
          <Plus className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <span className={label}>Add</span>
        </button>
      ) : null}

      {ownership === "mine" ? (
        <>
          <button
            type="button"
            disabled={busy}
            aria-label={`Drop ${player.name}`}
            onClick={() => ctx.requestDrop(player)}
            className={cn(
              pill,
              "border-[#e8551f]/70 bg-[#e8551f] text-white hover:bg-[#d14a18]",
            )}
          >
            <Minus className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <span className={label}>Drop</span>
          </button>
          <button
            type="button"
            disabled={busy}
            aria-label={`Trade ${player.name}`}
            onClick={() => ctx.requestTradeAway(player)}
            className={cn(
              pill,
              "border-[#f08a24]/70 bg-[#f08a24] text-white hover:max-w-[120px] hover:bg-[#e07c1a]",
            )}
          >
            <ArrowLeftRight className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <span className={label}>Trade</span>
          </button>
        </>
      ) : null}

      {ownership === "other" ? (
        <button
          type="button"
          disabled={busy}
          aria-label={`Trade for ${player.name}`}
          onClick={() => ctx.requestTradeFor(player)}
          className={cn(
            pill,
            "border-[#f08a24]/70 bg-[#f08a24] text-white hover:max-w-[120px] hover:bg-[#e07c1a]",
          )}
        >
          <ArrowLeftRight className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <span className={label}>Trade</span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * Back-compat: single mount with buttons + modals (hero-only callers).
 * Prefer Provider + Buttons when the compact sticky header also needs pills.
 */
export function NativeFantasyPopupRosterActions({ player }: { player: Player }) {
  return (
    <NativeFantasyPopupRosterProvider player={player}>
      <NativeFantasyPopupRosterButtons />
    </NativeFantasyPopupRosterProvider>
  );
}
