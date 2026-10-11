import { useEffect, useState } from "react";

/** Ease-out count-up used by TLN Scoring Updates and the scorebug. */
export function useCountUp(from: number, to: number, active: boolean, ms = 900): number {
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (!active) {
      setValue(to);
      return;
    }
    setValue(from);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - t) ** 3;
      setValue(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setValue(to);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, active, ms]);
  return value;
}
