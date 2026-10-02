import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type MobileThemePreference = "light" | "dark" | "system";
export type MobileTheme = "light" | "dark";

type MobileThemeValue = {
  preference: MobileThemePreference;
  theme: MobileTheme;
  setPreference: (next: MobileThemePreference) => void;
};

const STORAGE_KEY = "tlo.mobile-theme";

const MobileThemeContext = createContext<MobileThemeValue>({
  preference: "system",
  theme: "light",
  setPreference: () => {},
});

function readStoredPreference(): MobileThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

export function MobileThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<MobileThemePreference>(readStoredPreference);
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window !== "undefined" &&
      (window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false),
  );

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const setPreference = useCallback((next: MobileThemePreference) => {
    setPreferenceState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const theme: MobileTheme = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  const value = useMemo(() => ({ preference, theme, setPreference }), [preference, theme, setPreference]);

  return <MobileThemeContext.Provider value={value}>{children}</MobileThemeContext.Provider>;
}

export function useMobileTheme() {
  return useContext(MobileThemeContext);
}
