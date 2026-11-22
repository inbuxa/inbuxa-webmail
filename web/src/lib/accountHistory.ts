import type { Id } from "@/jmap/types";
import { useSession } from "@/store/session";
import { confirmLeaveUnsaved, hasUnsavedChanges } from "@/lib/unsavedChanges";

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

/*
 * Where each page sits, for "Back to my mail" (#143). The bar's button used to
 * open your own mail as a new page, so Back afterwards walked through the
 * group's pages again. Each page the app puts in the history now carries its
 * position, and the position of the last page that showed your own mail, so
 * the button can step back that far, the way pressing Back would.
 *
 * A page without them -- one added outside the router -- leaves the button
 * to fall back on replacing the page instead.
 */

const POS = "inbuxaPos";
const OWN = "inbuxaOwnPos";

function record(state: unknown): Record<string, unknown> {
  return state !== null && typeof state === "object" && !Array.isArray(state) ? (state as Record<string, unknown>) : {};
}

/** A page's position, and that of the last page at or before it that showed your own mail. */
export function positionsIn(state: unknown): { pos: number; own: number } | null {
  const r = record(state);
  const pos = r[POS];
  const own = r[OWN];
  if (typeof pos !== "number" || typeof own !== "number" || !Number.isInteger(pos) || !Number.isInteger(own) || own < 0 || own > pos) return null;
  return { pos, own };
}

/**
 * `next`, the state for a page about to be pushed or to replace the current
 * one, with its positions worked out from `current`'s. When the current page
 * has none, neither does the next: a guess could step back too far.
 */
export function withPositions(next: Record<string, unknown>, current: unknown, replace: boolean, viewing: Id | null): Record<string, unknown> {
  const { [POS]: _pos, [OWN]: _own, ...rest } = next;
  const cur = positionsIn(current);
  if (!cur) return rest;
  const pos = replace ? cur.pos : cur.pos + 1;
  return { ...rest, [POS]: pos, [OWN]: viewing === null ? pos : cur.own };
}

/** The page the app starts on: position 0 unless it already has one, showing `viewing`. */
export function startPositions(state: unknown, viewing: Id | null): Record<string, unknown> {
  const cur = positionsIn(state);
  const pos = cur?.pos ?? 0;
  return { ...record(state), [POS]: pos, [OWN]: viewing === null ? pos : (cur?.own ?? pos) };
}

/** How many pages back your own mail was last shown; 0 when it isn't known. */
export function stepsBackToOwn(state: unknown): number {
  const cur = positionsIn(state);
  return cur ? cur.pos - cur.own : 0;
}

/**
 * "Back to my mail" (#143): step back to the page your own mail was last on,
 * so the other account's pages leave the history, as Back would have done;
 * the popstate handler switches the account (followHistory). With a message
 * being written, which keeps the account it was started in on Back, or
 * without positions to go by, switch here and replace the page instead.
 */
export function backToOwnMail(navigate: (to: string, options?: { replace?: boolean }) => void, writing: boolean): void {
  const steps = writing ? 0 : stepsBackToOwn(window.history.state);
  if (steps > 0) {
    // A step back skips the router, and with it the question it asks before
    // leaving unsaved changes; ask it here.
    if (!hasUnsavedChanges()) window.history.go(-steps);
    else
      void confirmLeaveUnsaved().then((ok) => {
        if (ok) window.history.go(-steps);
      });
    return;
  }
  useSession.getState().view(null);
  navigate("/mail", { replace: true });
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
