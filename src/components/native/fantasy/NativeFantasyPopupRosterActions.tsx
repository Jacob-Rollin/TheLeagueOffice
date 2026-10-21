import { ArrowLeftRight, Minus, Plus } from "lucide-react";

import { useNativeRosterActions } from "@/components/mobile/league/nativeRosterActions";
import type { Player } from "@/lib/players-build";
import { cn } from "@/lib/utils";

/**
 * Compact Add / Drop / Trade controls for the desktop player popup header
 * (native Fantasy pages only). Ownership-aware — same mutations as mobile.
 */
export function NativeFantasyPopupRosterActions({ player }: { player: Player }) {
  const actions = useNativeRosterActions({ variant: "desktop" });
  if (!actions.isNative) return null;

  const ownership = actions.ownershipFor(player.id);
  const busy = actions.busy;

  const pill =
    "inline-flex max-w-[120px] cursor-pointer select-none items-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <>
      {ownership === "fa" ? (
        <button
          type="button"
          disabled={busy}
          aria-label={`Add ${player.name}`}
          onClick={() => actions.requestAdd(player)}
          className={cn(
            pill,
            "border-[#1fae5b]/70 bg-[#1fae5b] text-white hover:bg-[#1a9a50]",
          )}
        >
          <Plus className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          Add
        </button>
      ) : null}

      {ownership === "mine" ? (
        <>
          <button
            type="button"
            disabled={busy}
            aria-label={`Drop ${player.name}`}
            onClick={() => actions.requestDrop(player)}
            className={cn(
              pill,
              "border-[#e8551f]/70 bg-[#e8551f] text-white hover:bg-[#d14a18]",
            )}
          >
            <Minus className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            Drop
          </button>
          <button
            type="button"
            disabled={busy}
            aria-label={`Trade ${player.name}`}
            onClick={() => actions.requestTradeAway(player)}
            className={cn(
              pill,
              "border-[#f08a24]/70 bg-[#f08a24] text-white hover:bg-[#e07c1a]",
            )}
          >
            <ArrowLeftRight className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            Trade
          </button>
        </>
      ) : null}

      {ownership === "other" ? (
        <button
          type="button"
          disabled={busy}
          aria-label={`Trade for ${player.name}`}
          onClick={() => actions.requestTradeFor(player)}
          className={cn(
            pill,
            "border-[#f08a24]/70 bg-[#f08a24] text-white hover:bg-[#e07c1a]",
          )}
        >
          <ArrowLeftRight className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          Trade
        </button>
      ) : null}

      {actions.modals}
    </>
  );
}
