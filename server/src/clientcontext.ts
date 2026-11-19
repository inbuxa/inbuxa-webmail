import { AsyncLocalStorage } from "node:async_hooks";
import { isIP } from "node:net";

/*
 * inbuxa K-W3: the browser's address, passed on to the mail server.
 *
 * Every request the webmail makes for its users comes from the webmail's own
 * address. Without this, the server's limits and bans for failed sign-ins and
 * anonymous requests count all of a replica's users as one client: a hundred
 * new tokens a minute, or a hundred wrong passwords in a day, would lock
 * everyone on that replica out. With it, each person counts as themselves --
 * on a server that believes the header from the webmail (inbuxa: trusted
 * proxies and INBUXA_HTTP_USE_FORWARDED, or "Use X-Forwarded-For" on).
 *
 * Only requests to the mail server carry it. Fetches for remote images and
 * calendars go through imageproxy.ts and never do.
 */
const clientAddress = new AsyncLocalStorage<string>();

/** Runs `fn` with `ip` as the address the mail server is told about. */
export function withClientIp<T>(ip: string, fn: () => T): T {
  return clientAddress.run(ip, fn);
}

/**
 * fetch(), to the mail server: X-Forwarded-For set to the client the webmail
 * resolved (clientip.ts), replacing anything the browser sent. Outside a
 * request -- push, a background refresh -- no header is added.
 */
export function upstreamFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const ip = clientAddress.getStore();
  if (!ip || !isIP(ip)) return fetch(input, init);
  const headers = new Headers(init.headers);
  headers.set("x-forwarded-for", ip);
  return fetch(input, { ...init, headers });
}
