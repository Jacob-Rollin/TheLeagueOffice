import { Columns2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DesktopComparePicker } from "@/components/compare/DesktopComparePicker";
import { DesktopCompareSheet } from "@/components/compare/DesktopCompareSheet";
import { useSleeperPlayers } from "@/hooks/useSleeperPlayers";
import type { Player } from "@/lib/players-build";

/**
 * Site-wide Compare control for desktop PlayerDetail (popup + full page).
 * Hover expands like Watch; opens a Broadcast-scaled picker then results dialog.
 */
export function DesktopPlayerCompare({
  anchorPlayer,
  tone = "hero",
}: {
  /** Current player on the detail view (left side of the compare pair). */
  anchorPlayer: Player;
  /** `hero` = on team-color banner; `surface` = compact sticky bar on white. */
  tone?: "hero" | "surface";
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [comparePair, setComparePair] = useState<{ leftId: string; rightId: string } | null>(
    null,
  );
  const [replaceSide, setReplaceSide] = useState<"left" | "right" | null>(null);

  const { data: catalogPayload } = useSleeperPlayers();
  const catalogById = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of catalogPayload?.players ?? []) m.set(p.id, p);
    return m;
  }, [catalogPayload]);

  // Reset compare state when the underlying player changes.
  useEffect(() => {
    setPickerOpen(false);
    setComparePair(null);
    setReplaceSide(null);
  }, [anchorPlayer.id]);

  useEffect(() => {
    if (!pickerOpen && !comparePair) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pickerOpen) {
        setPickerOpen(false);
        setReplaceSide(null);
        return;
      }
      if (comparePair) setComparePair(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen, comparePair]);

  const pickerAnchor =
    replaceSide === "right" && comparePair
      ? (catalogById.get(comparePair.leftId) ?? anchorPlayer)
      : replaceSide === "left" && comparePair
        ? (catalogById.get(comparePair.rightId) ?? anchorPlayer)
        : anchorPlayer;

  const pickerExclude =
    replaceSide === "right" && comparePair
      ? comparePair.leftId
      : replaceSide === "left" && comparePair
        ? comparePair.rightId
        : anchorPlayer.id;

  const surface = tone === "surface";

  return (
    <>
      <button
        type="button"
        aria-label="Compare"
        onClick={() => {
          setReplaceSide(null);
          setPickerOpen(true);
        }}
        className={
          surface
            ? "group inline-flex max-w-[38px] cursor-pointer select-none items-center overflow-hidden whitespace-nowrap rounded-full border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700 shadow-sm transition-all duration-300 hover:max-w-[140px] hover:border-blue-600 hover:text-blue-700"
            : "group inline-flex max-w-[38px] cursor-pointer select-none items-center overflow-hidden whitespace-nowrap rounded-full border border-white/20 bg-white/5 px-2.5 py-1.5 transition-all duration-300 hover:max-w-[140px] hover:border-white/40 hover:bg-white/10"
        }
      >
        <Columns2
          className={surface ? "size-3.5 shrink-0" : "size-3.5 shrink-0 text-white/90"}
          strokeWidth={2.25}
        />
        <span
          className={
            surface
              ? "ml-1.5 text-[10px] font-black uppercase tracking-wider opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              : "ml-1.5 text-[10px] font-black uppercase tracking-wider text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100"
          }
        >
          Compare
        </span>
      </button>

      {pickerOpen ? (
        <DesktopComparePicker
          anchorPlayer={pickerAnchor}
          excludeId={pickerExclude}
          onClose={() => {
            setPickerOpen(false);
            setReplaceSide(null);
          }}
          onSelect={(picked) => {
            if (replaceSide === "left" && comparePair) {
              setComparePair({ leftId: picked.id, rightId: comparePair.rightId });
            } else if (replaceSide === "right" && comparePair) {
              setComparePair({ leftId: comparePair.leftId, rightId: picked.id });
            } else {
              setComparePair({ leftId: anchorPlayer.id, rightId: picked.id });
            }
            setPickerOpen(false);
            setReplaceSide(null);
          }}
        />
      ) : null}

      {comparePair ? (
        <DesktopCompareSheet
          leftId={comparePair.leftId}
          rightId={comparePair.rightId}
          onClose={() => setComparePair(null)}
          onChangeSide={(side) => {
            setReplaceSide(side);
            setPickerOpen(true);
          }}
        />
      ) : null}
    </>
  );
}
