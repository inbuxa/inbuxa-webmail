import type { Id } from "@/jmap/types";
import type { IcsEvent } from "./ics";
import { DAY_MS, parseDuration, toLocalDateTime } from "@/lib/dates";

/*
 * Event search: the requests, and the decisions about what comes back.
 *
 * The requests are built here rather than in the store, so a test can send
 * exactly what the app sends. Found against inbuxa-server 27.1-rc.9 on
 * 2026-11-06:
 *
 * - `filter: { text }` matches the title, the description and the locations,
 *   in any case, by whole word: "japanese" finds "Japanese Garden Cafe" and
 *   "japan" finds nothing. Several words must all match.
 * - Without `expandRecurrences` a series comes back once, as its master, at
 *   its first date. With it, both `after` and `before` are required, and the
 *   span is capped by `maxExpandedQueryDuration` (P52W1D). The server took
 *   366 days, but other JMAP servers refuse past their limit with
 *   `expandDurationTooLarge`, so the window stays inside it.
 * - The search index is written in the background, so an event saved a
 *   moment ago can be missing from the first search after it.
 *
 * So a series is found as its master, and its next date (or, once it has
 * ended, its latest) is asked for by uid in a window the server allows.
 */

/** Matches asked for from each account. */
export const SEARCH_LIMIT = 100;

type Call = [method: string, args: Record<string, unknown>, id: string];

/** The text query and the read of what it found, as one request. */
export function searchCalls(accountId: Id, text: string, timeZone: string, properties: string[]): Call[] {
  return [
    ["CalendarEvent/query", { accountId, filter: { text }, sort: [{ property: "start", isAscending: false }], limit: SEARCH_LIMIT, timeZone }, "q"],
    ["CalendarEvent/get", { accountId, "#ids": { resultOf: "q", name: "CalendarEvent/query", path: "/ids" }, properties, timeZone }, "g"],
  ];
}

/**
 * How far either side of now a series is expanded to find its next and
 * latest dates: the server's limit less a day, and never more than a year.
 * The day is margin, not arithmetic: a server that enforces its limit can
 * refuse a window of exactly that length, and the cost of a shorter one is
 * only that a series meeting less than once a year shows its first date.
 */
export function expandWindowMs(maxExpandedQueryDuration: string | null | undefined): number {
  const year = 365 * DAY_MS;
  const limit = parseDuration(maxExpandedQueryDuration) * 1000;
  return (limit > 0 ? Math.min(limit, year) : year) - DAY_MS;
}

/**
 * The query for a series' next date after `now`, and the one for its latest
 * before it: one occurrence each, by uid, expanded.
 */
export function occurrenceQueries(accountId: Id, uid: string, now: Date, windowMs: number, timeZone: string): { next: Record<string, unknown>; last: Record<string, unknown> } {
  const nowLocal = toLocalDateTime(now);
  return {
    next: {
      accountId,
      filter: { uid, after: nowLocal, before: toLocalDateTime(new Date(now.getTime() + windowMs)) },
      timeZone,
      sort: [{ property: "start", isAscending: true }],
      expandRecurrences: true,
      limit: 1,
    },
    last: {
      accountId,
      filter: { uid, after: toLocalDateTime(new Date(now.getTime() - windowMs)), before: nowLocal },
      timeZone,
      sort: [{ property: "start", isAscending: false }],
      expandRecurrences: true,
      limit: 1,
    },
  };
}

/** Results split around now: upcoming soonest first, then past most recent first. */
export function splitByNow<T extends { start: Date; end: Date }>(results: T[], now: Date): { upcoming: T[]; past: T[] } {
  const upcoming = results.filter((r) => r.end > now).sort((a, b) => a.start.getTime() - b.start.getTime());
  const past = results.filter((r) => r.end <= now).sort((a, b) => b.start.getTime() - a.start.getTime());
  return { upcoming, past };
}

/** Lowercase words, the way the query is split. */
function words(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Whether a subscribed calendar's event matches, decided here because those
 * events never reach the server. Same rule as the server's: every word of the
 * query is a whole word of the title, the description or the location.
 */
export function icsEventMatches(e: IcsEvent, text: string): boolean {
  const wanted = words(text);
  if (!wanted.length) return false;
  const have = new Set(words([e.summary, e.description ?? "", e.location ?? ""].join(" ")));
  return wanted.every((w) => have.has(w));
}
