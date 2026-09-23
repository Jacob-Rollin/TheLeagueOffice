import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  defaultScoringMap,
  projectionPoints,
  type ScoringFormat,
  type ScoringMap,
} from "@/lib/scoring-map";
import { cn } from "@/lib/utils";

export const SCORING_FORMAT_OPTIONS: { value: ScoringFormat; label: string }[] = [
  { value: "std", label: "Standard" },
  { value: "half", label: "Half PPR" },
  { value: "ppr", label: "Full PPR" },
];

/**
 * Research-board scoring picker. Defaults to the synced league format
 * (`override == null`); once the user picks a format, that choice sticks.
 */
export function useResearchScoringFormat(leagueFormat: ScoringFormat | null | undefined) {
  const [override, setOverride] = useState<ScoringFormat | null>(null);
  const format: ScoringFormat = override ?? leagueFormat ?? "half";
  return { format, override, setFormat: setOverride };
}

/** Map used to score research Proj / Fpts for the active picker state. */
export function researchScoringMap(
  format: ScoringFormat,
  override: ScoringFormat | null,
  leagueMap: ScoringMap | null | undefined,
): ScoringMap {
  // Follow league rules until the user explicitly picks a preset.
  if (override == null && leagueMap) return leagueMap;
  return defaultScoringMap(format);
}

export function scoreResearchProjection(
  stats: Record<string, number> | null | undefined,
  format: ScoringFormat,
  override: ScoringFormat | null,
  leagueMap: ScoringMap | null | undefined,
): number | null {
  return projectionPoints(stats, researchScoringMap(format, override, leagueMap), format);
}

export function ScoringFormatSelect({
  value,
  onChange,
  className,
  triggerClassName,
}: {
  value: ScoringFormat;
  onChange: (format: ScoringFormat) => void;
  className?: string;
  triggerClassName?: string;
}) {
  return (
    <div className={cn("w-[9.5rem] shrink-0", className)}>
      <Select value={value} onValueChange={(v) => onChange(v as ScoringFormat)}>
        <SelectTrigger
          className={cn(
            "h-9 w-full border-slate-200 bg-white text-sm font-medium text-slate-800 shadow-none",
            triggerClassName,
          )}
        >
          <SelectValue placeholder="Scoring" />
        </SelectTrigger>
        <SelectContent>
          {SCORING_FORMAT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Client-side red-zone FPTS from counting stats for std / half / ppr. */
export function redZoneFantasyPoints(
  row: {
    passYds: number;
    passTd: number;
    passInt: number;
    rushYds: number;
    rushTd: number;
    rec: number;
    recYds: number;
    recTd: number;
    fumLost: number;
    games: number;
  },
  format: ScoringFormat,
): { fpts: number; fptsPerGame: number } {
  const recPts = format === "ppr" ? 1 : format === "half" ? 0.5 : 0;
  const raw =
    row.passYds / 25 +
    row.passTd * 4 +
    row.passInt * -2 +
    row.rushYds / 10 +
    row.rushTd * 6 +
    row.rec * recPts +
    row.recYds / 10 +
    row.recTd * 6 -
    row.fumLost * 2;
  const fpts = Math.round(raw * 100) / 100;
  const fptsPerGame =
    row.games > 0 ? Math.round((raw / row.games) * 100) / 100 : 0;
  return { fpts, fptsPerGame };
}

/** Stable label for page copy when the active format changes. */
export function scoringFormatLabel(format: ScoringFormat): string {
  return SCORING_FORMAT_OPTIONS.find((o) => o.value === format)?.label ?? "Half PPR";
}
