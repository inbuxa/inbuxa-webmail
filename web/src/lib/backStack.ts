import { useLocation } from "wouter";
import { useMail } from "@/store/mail";
import { isInstalledApp } from "@/lib/mailhandler";

/*
 * What Back does in the installed app (#96). A browser tab keeps every page
 * it visited, as a web page should. An installed app is expected to work
 * like one: Back goes to where you came from in the app, and from the inbox
 * it closes the app. So there, moving between folders and sections replaces
 * the page in the history, except when leaving the inbox, which is the one
 * page Back should return to. The stack stays inbox → folder → message.
 */

/** Whether `location` is the inbox, the app's home. */
export function isHome(location: string, inboxId: string | undefined): boolean {
  const path = location.replace(/\/+$/, "") || "/";
  return path === "/" || path === "/mail" || (inboxId !== undefined && path === `/mail/${inboxId}`);
}

/** The id of the inbox among `mailboxes`, if it has loaded. */
export function inboxIdOf(mailboxes: Record<string, { id: string; role?: string | null }>): string | undefined {
  for (const m of Object.values(mailboxes)) if (m.role === "inbox") return m.id;
  return undefined;
}

/*
 * What the page behind this one shows (#142). Replacing every sideways move
 * keeps the inbox behind a folder, but going from that folder to the inbox
 * replaced the folder with a second inbox: Back then landed on the inbox
 * already on screen and seemed to do nothing. So a pushed page records
 * whether the page it was pushed from was the inbox, and whose; a replaced
 * page keeps what the one it replaced had. Going to the inbox with the same
 * account's inbox behind steps back to it instead.
 */

const BEHIND = "inbuxaBehind";

/** `next` with what is behind it recorded: the current page when pushing, or what is behind the current page when replacing it. */
export function withBehind(next: Record<string, unknown>, current: unknown, replace: boolean, currentIsHome: boolean, currentViewing: string | null): Record<string, unknown> {
  const { [BEHIND]: _old, ...rest } = next;
  if (!replace) return { ...rest, [BEHIND]: { home: currentIsHome, viewing: currentViewing } };
  const kept = current !== null && typeof current === "object" ? (current as Record<string, unknown>)[BEHIND] : undefined;
  return kept === undefined ? rest : { ...rest, [BEHIND]: kept };
}

/** Whether the page behind `state`'s is the inbox of the account `viewing`. */
export function homeIsBehind(state: unknown, viewing: string | null): boolean {
  if (state === null || typeof state !== "object") return false;
  const b = (state as Record<string, unknown>)[BEHIND];
  if (b === null || typeof b !== "object") return false;
  const { home, viewing: whose } = b as { home?: unknown; viewing?: unknown };
  return home === true && (typeof whose === "string" ? whose : null) === viewing;
}

/**
 * Whether a move from `from` to `to` should be a step back instead: in the
 * installed app, a sideways move (one that would replace the page) to the
 * inbox, from a page that isn't the inbox, with that inbox behind it.
 */
export function stepsBackHome(from: string, to: string, inboxId: string | undefined, installed: boolean, replace: boolean, state: unknown, viewing: string | null): boolean {
  const target = to.split(/[?#]/)[0] ?? to;
  return installed && replace && isHome(target, inboxId) && !isHome(from, inboxId) && homeIsBehind(state, viewing);
}

/** Whether a move to another folder or section should replace the current page. */
export function sidewaysReplaces(location: string, inboxId: string | undefined, installed: boolean): boolean {
  return installed && !isHome(location, inboxId);
}

/** sidewaysReplaces for the page being shown. Pass the result as a link's or navigate's `replace`. */
export function useSidewaysReplace(): boolean {
  const [location] = useLocation();
  const inboxId = useMail((s) => inboxIdOf(s.mailboxes));
  return sidewaysReplaces(location, inboxId, isInstalledApp());
}
