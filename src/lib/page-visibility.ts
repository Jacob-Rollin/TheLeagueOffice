import { useEffect, useState } from "react";

/** True when this tab is visible (not backgrounded / minimized). */
export function isPageVisible(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}

/**
 * React hook for document visibility. Use to pause polls that burn
 * Vercel / TiDB / visitor Sleeper quotas while the tab is hidden.
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(isPageVisible);
  useEffect(() => {
    const onChange = () => setVisible(isPageVisible());
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

/**
 * Wrap a React Query refetchInterval so hidden tabs never poll.
 * Pass `false` / number / function the same way RQ accepts.
 */
export function visibleRefetchInterval(
  interval: number | false | ((query: { state: { data: unknown } }) => number | false | undefined),
): number | false | ((query: { state: { data: unknown } }) => number | false | undefined) {
  if (typeof interval === "function") {
    return (query) => {
      if (!isPageVisible()) return false;
      return interval(query) ?? false;
    };
  }
  if (interval === false) return false;
  return () => (isPageVisible() ? interval : false);
}
