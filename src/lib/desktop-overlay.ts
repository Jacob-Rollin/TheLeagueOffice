/**
 * Nested desktop dialogs (compare, add/drop/trade pickers) mark themselves with
 * `data-desktop-overlay`. While any are open, the player popup must not scroll
 * underneath (PlayerModal redirects wheel events globally otherwise).
 */

export const DESKTOP_OVERLAY_ATTR = "data-desktop-overlay";

const PLAYER_POPUP_SCROLL_ID = "player-popup-scroll-container";

export function hasDesktopOverlay(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector(`[${DESKTOP_OVERLAY_ATTR}]`));
}

/** Freeze / unfreeze the player popup scroller while a nested overlay is mounted. */
export function freezePlayerPopupScroll(freeze: boolean) {
  if (typeof document === "undefined") return;
  const el = document.getElementById(PLAYER_POPUP_SCROLL_ID);
  if (!el) return;
  if (freeze) {
    if (el.dataset["prevOverflow"] == null) {
      el.dataset["prevOverflow"] = el.style.overflowY || "";
    }
    el.style.overflowY = "hidden";
  } else if (!hasDesktopOverlay()) {
    el.style.overflowY = el.dataset["prevOverflow"] || "";
    delete el.dataset["prevOverflow"];
  }
}
