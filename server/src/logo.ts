/**
 * ihasmail-inbuxa: the mail server's branding logo, for the sign-in page and the top bar
 * (inbuxa-webmail #101).
 *
 * The server answers `GET /logo` with the logo that applies to a domain: the
 * image itself, a redirect to a logo set as an https URL, or 404 when none is
 * set (branding BT-5). `?theme=dark` asks for the one set for dark mode,
 * falling back to the ordinary one (BT-27, inbuxa-server #410).
 *
 * The browser doesn't know the mail server's address, so this asks on its
 * behalf and hands the answer on, the way the server would have:
 *
 * - An image is passed on as it is, with the server's own protections: no
 *   type sniffing, and a sandbox for SVG so a script in one never runs here.
 * - A logo set as an https URL becomes a redirect to the image proxy
 *   (`/api/image`), the way remote images in mail are shown: the page's
 *   Content-Security-Policy loads images from this origin only, and the proxy
 *   checks where it may connect. The proxy needs a signed-in reader, so the
 *   sign-in page shows its built-in logo for a URL logo; a logo stored as an
 *   image shows everywhere. Like the server, this redirects only an image
 *   load (`Sec-Fetch-Dest: image`). This module itself fetches no URL a logo
 *   names.
 * - Anything else is a 404, and the page shows its built-in logo.
 *
 * Answers are kept for five minutes, the time the server lets a browser keep
 * one, so every reader's page load doesn't become a request to the server,
 * whose anonymous-request limit counts this process as one address.
 */
import type { Context } from "hono";
import { config } from "./config.js";
import { upstreamFor } from "./upstream.js";
import { upstreamFetch } from "./clientcontext.js";

/** How long an answer is kept, here and in the browser. */
const TTL_MS = 5 * 60_000;
/** The server refuses a logo over 256 KiB (BT-3); a little room for headers. */
const MAX_BYTES = 300 * 1024;
const MAX_ENTRIES = 256;
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

type Answer =
  | { kind: "image"; contentType: string; body: Uint8Array }
  | { kind: "redirect"; location: string }
  | { kind: "none" };

const cache = new Map<string, { answer: Answer; expires: number }>();

/** A domain name as a query may carry it: letters, digits, dots and hyphens. */
export function cleanDomain(value: string | undefined): string {
  const domain = (value ?? "").trim().toLowerCase().replace(/\.$/, "");
  return domain.length <= 253 && /^[a-z0-9.-]+$/.test(domain) ? domain : "";
}

/** Asks the server; never follows a redirect and never throws. */
async function ask(base: string, domain: string, dark: boolean): Promise<Answer> {
  const params = new URLSearchParams();
  if (domain) params.set("domain", domain);
  if (dark) params.set("theme", "dark");
  const query = params.toString();
  try {
    const res = await upstreamFetch(`${base}/logo${query ? `?${query}` : ""}`, {
      // The server redirects to a URL logo only for an image load
      headers: { "sec-fetch-dest": "image", accept: "image/*" },
      redirect: "manual",
      signal: AbortSignal.timeout(Math.min(config.upstreamTimeout, 10_000)),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location") ?? "";
      return /^https:\/\/[^\s/?#]/i.test(location) && !/[\s\x00-\x1f]/.test(location) ? { kind: "redirect", location } : { kind: "none" };
    }
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (res.status !== 200 || !/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(contentType)) {
      await res.body?.cancel();
      return { kind: "none" };
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) {
      await res.body?.cancel();
      return { kind: "none" };
    }
    const body = new Uint8Array(await res.arrayBuffer());
    return body.byteLength > 0 && body.byteLength <= MAX_BYTES ? { kind: "image", contentType, body } : { kind: "none" };
  } catch {
    return { kind: "none" };
  }
}

/** The server's answer for a domain and theme, from the cache when fresh. */
export async function serverLogo(domain: string, dark: boolean, now = Date.now()): Promise<Answer> {
  const base = domain ? upstreamFor(`logo@${domain}`) : config.stalwartUrl;
  const key = `${base}\n${domain}\n${dark ? "dark" : "light"}`;
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.answer;
  const answer = await ask(base, domain, dark);
  cache.delete(key);
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, { answer, expires: now + TTL_MS });
  return answer;
}

/** Forgets every kept answer; for tests. */
export function clearLogoCache(): void {
  cache.clear();
}

/** `GET /api/logo?domain=&theme=dark`. */
export async function logoHandler(c: Context): Promise<Response> {
  const domain = cleanDomain(c.req.query("domain"));
  const dark = c.req.query("theme") === "dark";
  const answer = await serverLogo(domain, dark);
  c.header("X-Content-Type-Options", "nosniff");
  if (answer.kind === "image") {
    c.header("Content-Type", answer.contentType);
    c.header("Cache-Control", `public, max-age=${TTL_MS / 1000}`);
    if (answer.contentType === "image/svg+xml") c.header("Content-Security-Policy", SVG_CSP);
    return c.body(answer.body as unknown as ArrayBuffer, 200);
  }
  if (answer.kind === "redirect") {
    // Who asks decides the answer, so no shared cache may keep it
    c.header("Cache-Control", "no-store");
    c.header("Vary", "Sec-Fetch-Dest");
    if ((c.req.header("sec-fetch-dest") ?? "").toLowerCase() === "image") {
      c.header("Location", `${config.basePath}/api/image?url=${encodeURIComponent(answer.location)}`);
      return c.body(null, 302);
    }
    return c.body(null, 404);
  }
  c.header("Cache-Control", `public, max-age=${TTL_MS / 1000}`);
  return c.body(null, 404);
}
