import type { Id } from "@/jmap/types";
import { useSession } from "@/store/session";

/*
 * Which account a page in the history was showing (#133).
 *
 * The account in view -- your own, or a shared or group mailbox, or a locked
 * account handed to you -- isn't part of the address: /mail/<folder> reads the
 * same whichever account it belongs to. So each page the app puts in the
 * history carries the account it was showing in `history.state`, and Back or
 * Forward onto a page that showed another account switches back to it.
 *
 * A page with no mark is your own account. That covers the page the app was
 * opened on, since a fresh start always shows your own mail.
 */

const KEY = "inbuxaViewing";

/** `state` with the account in view written into it, for pushState/replaceState. */
export function withViewing(state: unknown, viewing: Id | null): Record<string, unknown> {
  const base = state !== null && typeof state === "object" && !Array.isArray(state) ? (state as Record<string, unknown>) : {};
  return { ...base, [KEY]: viewing };
}

/** The account a history entry was showing; null for your own. */
export function viewingIn(state: unknown): Id | null {
  if (state === null || typeof state !== "object") return null;
  const v = (state as Record<string, unknown>)[KEY];
  return typeof v === "string" && v ? v : null;
}

/**
 * Follow Back or Forward onto a page that showed another account.
 *
 * - "same": the page shows the account already in view; nothing to do.
 * - "kept": a message is being written, and it belongs to the account it was
 *   started in, as for the switch in the menu; the account doesn't change.
 * - "switched": the account in view now matches the page, or is your own if
 *   the page's account is gone since (a share taken away, a delegation
 *   ended, someone else signed in on this tab).
 */
export function followHistory(state: unknown, writing: boolean): "same" | "kept" | "switched" {
  const want = viewingIn(state);
  const session = useSession.getState();
  if (want === session.viewing) return "same";
  if (writing) return "kept";
  session.view(want);
  if (useSession.getState().viewing !== want) session.view(null);
  return "switched";
}

/*
 * One popstate listener, added when this module loads -- before anything
 * renders, so before the router's. Listeners on window run in the order they
 * were added, whatever their phase, and this one has to go first: the
 * account must change before the page for the new address renders, or the
 * mail view looks up one account's folder in the other's list, doesn't find
 * it, and says the folder no longer exists. The router adds its listener
 * when it first renders, and adds it again whenever it has been dropped, so
 * it always comes after this one.
 */
let onMove: ((e: PopStateEvent) => void) | null = null;
if (typeof window !== "undefined") window.addEventListener("popstate", (e) => onMove?.(e));

/** Handle Back and Forward ahead of the router. Returns the undo. */
export function onHistoryMove(handler: (e: PopStateEvent) => void): () => void {
  onMove = handler;
  return () => {
    if (onMove === handler) onMove = null;
  };
}
