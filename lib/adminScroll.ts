// Admin saves are server actions that redirect back to the same page, which
// Next scrolls to the top — on a 3,600-row Product Master that means scrolling
// back down after every edit. The admin layout records the scroll position when
// a form is submitted (or an in-page link is clicked) and puts it back once the
// redirect lands; these helpers hold the decision logic so it can be tested.
export const ADMIN_SCROLL_KEY = "admin-scroll-v1";
export const SCROLL_MAX_AGE_MS = 15_000;

export interface SavedScroll {
  path: string;
  y: number;
  at: number;
}

export function parseSavedScroll(raw: string | null): SavedScroll | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedScroll>;
    if (typeof value.path === "string" && typeof value.y === "number" && Number.isFinite(value.y) && typeof value.at === "number") {
      return { path: value.path, y: value.y, at: value.at };
    }
  } catch {
    // malformed or unavailable storage: treat as nothing saved
  }
  return null;
}

/** The scroll offset to restore, or null when the saved position is for a
 *  different page, too old (a fresh visit, not a redirect), or pointless. */
export function scrollToRestore(saved: SavedScroll | null, pathname: string, now: number): number | null {
  if (!saved) return null;
  if (saved.path !== pathname) return null;
  if (now - saved.at > SCROLL_MAX_AGE_MS || now < saved.at) return null;
  return saved.y > 0 ? saved.y : null;
}
