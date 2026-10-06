/**
 * Signing in through the mail server's own page (OAuth 2.0 authorization code
 * with PKCE), so ihasmail never handles a password to sign someone in.
 *
 * The flow, with ihasmail as a confidential client registered on the server:
 *
 * 1. `start()` picks the account's server from the username, reads the
 *    server's OAuth metadata, and sends the browser to its sign-in page with
 *    a PKCE challenge and a one-time `state`. The state is bound to the
 *    browser by a short-lived cookie, so a callback carrying somebody else's
 *    code can't sign this browser into their account.
 * 2. The person signs in there, two-factor included, and the server sends the
 *    browser back to `/api/auth/callback` with a code.
 * 3. `finish()` checks the state, exchanges the code (with the PKCE verifier
 *    and this client's secret) for an access and a refresh token, and the
 *    session keeps those, sealed, instead of a password.
 *
 * Access tokens last an hour; `refreshTokens()` renews them before they run
 * out. A password change on the server revokes both tokens, which ends every
 * session holding them -- the safe result, and the one the web app is told
 * about.
 *
 * Nothing here is taken from another client's implementation; the shapes are
 * RFC 6749, RFC 7636 and RFC 8414.
 */
import { createHash } from "node:crypto";
import { config } from "./config.js";
import { randomToken } from "./crypto.js";
import { UpstreamError, absoluteUpstream } from "./upstream.js";

export interface TokenSet {
  access: string;
  refresh: string | null;
  /** When the access token expires, in ms since the epoch. */
  expiresAt: number;
}

interface Metadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
}

/** Renew an access token this long before it expires. */
export const REFRESH_MARGIN_MS = 5 * 60_000;
/** How long a sign-in may take between leaving and coming back. */
const PENDING_TTL_MS = 10 * 60_000;
const METADATA_TTL_MS = 60 * 60_000;
const MAX_PENDING = 10_000;

export function oauthEnabled(): boolean {
  return Boolean(config.oauthClientSecret);
}

/**
 * Whether every account is on the same server. Then sign-in needs no address
 * first: the server's page asks for the username itself. With several servers
 * (MAIL_SERVERS_FILE), the domain picks the server, so the address comes
 * first.
 */
export function singleServer(): boolean {
  return Object.values(config.stalwartServers).every((url) => url === config.stalwartUrl);
}

/** The one redirect URI registered for this client on the server. */
export function redirectUri(): string {
  return `${config.publicUrl}${config.basePath}/api/auth/callback`;
}

const metadataCache = new Map<string, { metadata: Metadata; fetchedAt: number }>();

async function metadataFor(base: string): Promise<Metadata> {
  const cached = metadataCache.get(base);
  if (cached && Date.now() - cached.fetchedAt < METADATA_TTL_MS) return cached.metadata;
  const res = await fetch(`${base}/.well-known/oauth-authorization-server`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(config.upstreamTimeout),
  });
  if (!res.ok) throw new UpstreamError(`OAuth metadata request failed (${res.status})`, 502);
  const doc = (await res.json()) as { authorization_endpoint?: string; token_endpoint?: string; scopes_supported?: string[] };
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new UpstreamError("The mail server's OAuth metadata has no authorization or token endpoint", 502);
  }
  const metadata = {
    // Where the *browser* goes, so the server's public address, as advertised.
    authorizationEndpoint: new URL(doc.authorization_endpoint, base).toString(),
    // Where this process goes, so the configured route, like every other call.
    tokenEndpoint: absoluteUpstream(doc.token_endpoint, base),
    scopes: doc.scopes_supported ?? [],
  };
  metadataCache.set(base, { metadata, fetchedAt: Date.now() });
  return metadata;
}

interface Pending {
  verifier: string;
  base: string;
  username: string;
  remember: boolean;
  /** MA-B: signing in a second account beside the one in front. */
  adding: boolean;
  createdAt: number;
}

const pending = new Map<string, Pending>();

function sweepPending(now = Date.now()) {
  for (const [state, p] of pending) if (now - p.createdAt > PENDING_TTL_MS) pending.delete(state);
}

function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Begin a sign-in. Returns where to send the browser, and the state to bind
 * to it in a cookie.
 */
export async function start(params: { username: string; base: string; remember: boolean; adding?: boolean }): Promise<{ location: string; state: string }> {
  const metadata = await metadataFor(params.base);
  sweepPending();
  if (pending.size >= MAX_PENDING) throw new UpstreamError("Too many sign-ins in progress", 503);
  const state = randomToken(24);
  const verifier = randomToken(48);
  pending.set(state, { verifier, base: params.base, username: params.username, remember: params.remember, adding: Boolean(params.adding), createdAt: Date.now() });
  const scope = ["openid", "offline_access"].filter((s) => metadata.scopes.length === 0 || metadata.scopes.includes(s)).join(" ");
  const url = new URL(metadata.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.oauthClientId);
  url.searchParams.set("redirect_uri", redirectUri());
  if (scope) url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challengeOf(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  if (params.username) url.searchParams.set("login_hint", params.username);
  // MA-B: ask again, rather than let the server's page reuse the sign-in of
  // the account already in front
  if (params.adding) url.searchParams.set("prompt", "login");
  return { location: url.toString(), state };
}

/**
 * Whether `password` is the account's password, for a session that holds a
 * token and so has no password to compare with.
 *
 * Asked of the server's sign-in endpoint, the one its own sign-in page posts
 * to, because the server takes no password over JMAP (contract C-23). The
 * request is this client's, to its registered redirect URI, so it passes the
 * same checks a real sign-in does. A code it issues can never be exchanged:
 * the PKCE verifier behind its challenge is thrown away here.
 *
 * "Two-factor code needed" counts as confirmed: the server says so only once
 * the password has matched.
 */
export async function passwordConfirms(params: { base: string; username: string; password: string }): Promise<boolean> {
  const res = await fetch(absoluteUpstream("/api/auth", params.base), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      type: "authCode",
      accountName: params.username,
      accountSecret: params.password,
      clientId: config.oauthClientId,
      redirectUri: redirectUri(),
      codeChallenge: challengeOf(randomToken(48)),
      codeChallengeMethod: "S256",
    }),
    signal: AbortSignal.timeout(config.upstreamTimeout),
  });
  if (!res.ok) throw new UpstreamError(`Password check failed (${res.status})`, 502);
  const answer = (await res.json()) as { type?: string };
  return answer.type === "authenticated" || answer.type === "mfaRequired";
}

export class SignInError extends Error {
  constructor(readonly code: "state_mismatch" | "expired" | "denied" | "exchange_failed", message: string) {
    super(message);
  }
}

/**
 * Finish a sign-in: `state` as it came back in the URL, `boundState` as the
 * browser's cookie holds it. Each state is good for one attempt.
 */
export async function finish(params: { state: string; boundState: string | undefined; code: string }): Promise<{ tokens: TokenSet; base: string; username: string; remember: boolean; adding: boolean }> {
  const p = pending.get(params.state);
  if (!p || !params.boundState || params.boundState !== params.state) {
    throw new SignInError("state_mismatch", "This sign-in didn't start in this browser. Try again.");
  }
  pending.delete(params.state);
  if (Date.now() - p.createdAt > PENDING_TTL_MS) throw new SignInError("expired", "The sign-in took too long. Try again.");
  const metadata = await metadataFor(p.base);
  const tokens = await tokenRequest(metadata.tokenEndpoint, {
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: p.verifier,
    redirect_uri: redirectUri(),
  });
  if (!tokens) throw new SignInError("exchange_failed", "The mail server didn't accept the sign-in. Try again.");
  return { tokens, base: p.base, username: p.username, remember: p.remember, adding: p.adding };
}

/**
 * Renew an access token. Null when the server refuses the refresh token --
 * revoked by a password change, expired, or the client's secret changed --
 * which ends the session. Throws when the server couldn't be asked.
 */
export async function refreshTokens(base: string, tokens: TokenSet): Promise<TokenSet | null> {
  if (!tokens.refresh) return null;
  const metadata = await metadataFor(base);
  const renewed = await tokenRequest(metadata.tokenEndpoint, { grant_type: "refresh_token", refresh_token: tokens.refresh });
  // The server hands out a new refresh token only when the old one is close
  // to expiring; otherwise the old one stays good.
  return renewed && { ...renewed, refresh: renewed.refresh ?? tokens.refresh };
}

async function tokenRequest(endpoint: string, fields: Record<string, string>): Promise<TokenSet | null> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ ...fields, client_id: config.oauthClientId, client_secret: config.oauthClientSecret }),
    signal: AbortSignal.timeout(config.upstreamTimeout),
  });
  if (res.status === 400 || res.status === 401) return null;
  if (!res.ok) throw new UpstreamError(`Token request failed (${res.status})`, 502);
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string };
  if (!body.access_token || (body.token_type && body.token_type.toLowerCase() !== "bearer")) {
    throw new UpstreamError("The mail server returned no usable access token", 502);
  }
  return {
    access: body.access_token,
    refresh: body.refresh_token ?? null,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

export function needsRefresh(tokens: TokenSet, now = Date.now()): boolean {
  return tokens.expiresAt - now < REFRESH_MARGIN_MS;
}

/** For tests. */
export function resetOAuthState(): void {
  pending.clear();
  metadataCache.clear();
}
