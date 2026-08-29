import { useEffect, useState } from "react";

import { hydratePlayerBrain, type BrainMatrix } from "@/lib/playerBrainHydration";

/**
 * Read-only accessor for the locally compiled `master_player_analytics_db`
 * matrix. Purely additive: it never blocks render and never mutates any
 * existing draft/search data source.
 */
export function usePlayerBrain(): BrainMatrix | null {
  const [matrix, setMatrix] = useState<BrainMatrix | null>(null);

  useEffect(() => {
    let alive = true;
    hydratePlayerBrain()
      .then((m) => {
        if (alive && m) setMatrix(m);
      })
      .catch(() => {
        /* silent by design */
      });
    return () => {
      alive = false;
    };
  }, []);

  return matrix;
}
