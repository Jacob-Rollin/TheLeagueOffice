import { useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  NATIVE_LOGO_COLORS,
  NATIVE_LOGO_POOL,
  NATIVE_LOGO_SHAPES,
  nativeLogoDataUri,
  teamLogoInitial,
  type NativeLogoColorId,
  type NativeLogoShape,
} from "@/lib/native-team-logos";
import { cn } from "@/lib/utils";

type NativeTeamLogoPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamName: string;
  currentKey: string | null;
  busy?: boolean;
  onSelect: (key: string) => void | Promise<void>;
};

const SHAPE_FILTER_LABEL: Record<NativeLogoShape | "all", string> = {
  all: "All",
  helmet: "Helmet",
  shield: "Shield",
  ball: "Ball",
  star: "Star",
  bolt: "Bolt",
};

export function NativeTeamLogoPicker({
  open,
  onOpenChange,
  teamName,
  currentKey,
  busy = false,
  onSelect,
}: NativeTeamLogoPickerProps) {
  const [shapeFilter, setShapeFilter] = useState<NativeLogoShape | "all">("all");
  const [colorFilter, setColorFilter] = useState<NativeLogoColorId | "all">("all");
  const [pending, setPending] = useState<string | null>(null);

  const options = useMemo(() => {
    return NATIVE_LOGO_POOL.filter((o) => {
      if (shapeFilter !== "all" && o.shape !== shapeFilter) return false;
      if (colorFilter !== "all" && o.colorId !== colorFilter) return false;
      return true;
    });
  }, [shapeFilter, colorFilter]);

  const previewInitial = teamLogoInitial(teamName);
  const selected = pending ?? currentKey;

  const confirm = async () => {
    if (!pending || pending === currentKey || busy) {
      onOpenChange(false);
      return;
    }
    await onSelect(pending);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) setPending(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-lg overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Change team logo</DialogTitle>
          <DialogDescription>
            Pick a logo for <span className="font-medium text-foreground">{teamName}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {(["all", ...NATIVE_LOGO_SHAPES] as const).map((shape) => (
            <button
              key={shape}
              type="button"
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium",
                shapeFilter === shape
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-blue-700",
              )}
              onClick={() => setShapeFilter(shape)}
            >
              {SHAPE_FILTER_LABEL[shape]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium",
              colorFilter === "all"
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-blue-700",
            )}
            onClick={() => setColorFilter("all")}
          >
            All colors
          </button>
          {NATIVE_LOGO_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.id}
              aria-label={c.id}
              className={cn(
                "size-7 rounded-full border-2",
                colorFilter === c.id ? "border-blue-600 ring-2 ring-blue-200" : "border-white shadow-sm",
              )}
              style={{ backgroundColor: c.fill }}
              onClick={() => setColorFilter(c.id)}
            />
          ))}
        </div>

        <div className="max-h-[42vh] overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/60 p-2">
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
            {options.map((opt) => {
              const src = nativeLogoDataUri(opt.key, previewInitial);
              const isSelected = selected === opt.key;
              const title =
                opt.shape === "bolt" ? `${opt.label} (no letter)` : opt.label;
              return (
                <button
                  key={opt.key}
                  type="button"
                  title={title}
                  disabled={busy}
                  className={cn(
                    "flex aspect-square items-center justify-center overflow-hidden rounded-full border bg-white p-0.5 transition",
                    isSelected
                      ? "border-blue-600 ring-2 ring-blue-200"
                      : "border-slate-200 hover:border-slate-400",
                  )}
                  onClick={() => setPending(opt.key)}
                >
                  {src ? (
                    <img src={src} alt="" className="size-full object-cover" />
                  ) : null}
                </button>
              );
            })}
          </div>
          {options.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No logos match.</p>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <button
            type="button"
            className="rounded-md border border-border bg-white px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-60"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            disabled={busy || !pending || pending === currentKey}
            onClick={() => void confirm()}
          >
            {busy ? "Saving…" : "Save logo"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
