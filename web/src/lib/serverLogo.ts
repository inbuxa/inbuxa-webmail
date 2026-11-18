import { useEffect, useSyncExternalStore } from "react";
import { withBase } from "@/lib/basePath";
import { useEffectiveTheme } from "@/store/settings";
import { useSession } from "@/store/session";

/**
 * The logo the mail server's administrator set (inbuxa-webmail #101), for the
 * sign-in page and the top bar, instead of the built-in one.
 *
 * `/api/logo` asks the server for the logo that applies to a domain: the
 * signed-in reader's own, or the server's default before anybody signs in.
 * The dark theme asks for the one set for dark mode, which the server falls
 * back from to the ordinary one (inbuxa-server #410).
 *
 * Probed with an image, not a fetch, the way the server's own pages do it:
 * a logo set as a URL arrives as a redirect, and only an image load is
 * redirected. Each URL is probed once per page load.
 */
export type ServerLogo = { status: "loading" } | { status: "custom"; url: string } | { status: "default" };

const LOADING: ServerLogo = { status: "loading" };
const probes = new Map<string, ServerLogo>();
const watchers = new Set<() => void>();

function subscribe(watch: () => void): () => void {
  watchers.add(watch);
  return () => void watchers.delete(watch);
}

/** The `/api/logo` URL for a domain and theme. */
export function serverLogoUrl(domain: string, theme: "light" | "dark"): string {
  const params = new URLSearchParams();
  if (domain) params.set("domain", domain);
  if (theme === "dark") params.set("theme", "dark");
  const query = params.toString();
  return withBase(`/api/logo${query ? `?${query}` : ""}`);
}

/** Starts the probe for a URL; later calls for it do nothing. */
export function probeServerLogo(url: string): void {
  if (probes.has(url)) return;
  probes.set(url, LOADING);
  const image = new Image();
  const settle = (state: ServerLogo) => {
    probes.set(url, state);
    for (const watch of watchers) watch();
  };
  image.onload = () => settle({ status: "custom", url });
  image.onerror = () => settle({ status: "default" });
  image.src = url;
}

/** Forgets every probe; for tests. */
export function resetServerLogos(): void {
  probes.clear();
}

/** The domain of an address, or "" for a bare name. */
export function domainOf(username: string | null | undefined): string {
  const at = (username ?? "").lastIndexOf("@");
  return at < 0 ? "" : username!.slice(at + 1).trim().toLowerCase();
}

/** The server's logo for the reader in front, in the theme on screen. */
export function useServerLogo(): ServerLogo {
  const theme = useEffectiveTheme();
  const domain = domainOf(useSession((s) => s.session?.username));
  const url = serverLogoUrl(domain, theme);
  const read = () => probes.get(url) ?? LOADING;
  const logo = useSyncExternalStore(subscribe, read, read);
  useEffect(() => probeServerLogo(url), [url]);
  return logo;
}
