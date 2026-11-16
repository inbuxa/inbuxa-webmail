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

/** Whether a move to another folder or section should replace the current page. */
export function sidewaysReplaces(location: string, inboxId: string | undefined, installed: boolean): boolean {
  return installed && !isHome(location, inboxId);
}

/** sidewaysReplaces for the page being shown. Pass the result as a link's or navigate's `replace`. */
export function useSidewaysReplace(): boolean {
  const [location] = useLocation();
  const inboxId = useMail((s) => {
    for (const m of Object.values(s.mailboxes)) if (m.role === "inbox") return m.id;
    return undefined;
  });
  return sidewaysReplaces(location, inboxId, isInstalledApp());
}
