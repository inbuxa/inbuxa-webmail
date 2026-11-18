/**
 * The mock's OAuth side, enough to sign in the way INBUXA's server does:
 * metadata, a sign-in page, and a token endpoint for one confidential client.
 *
 * The sign-in page approves the demo user at once: there is no form, since
 * what's being exercised is ihasmail's side of the flow. Tokens are tied to
 * the password they were issued under, so a password change revokes them,
 * as it does on the real server.
 */
import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { PORT, USER, account } from "./config.js";

export const OAUTH_CLIENT_ID = process.env.MOCK_OAUTH_CLIENT_ID ?? "ihasmail-inbuxa";
export const OAUTH_CLIENT_SECRET = process.env.MOCK_OAUTH_CLIENT_SECRET ?? "mock-oauth-secret";
/** Seconds an access token lasts. */
export let accessTokenTtl = Number(process.env.MOCK_OAUTH_TOKEN_TTL ?? 3600);

interface Grant { password: string }
const codes = new Map<string, { challenge: string; redirectUri: string; issuedAt: number }>();
const accessTokens = new Map<string, Grant & { expiresAt: number }>();
const refreshTokens = new Map<string, Grant>();

const base = () => `http://127.0.0.1:${PORT}`;

/**
 * Whether JMAP refuses Basic, as INBUXA's server does outside DAV (contract
 * C-23). Off by default, since the mock also serves password sign-in.
 */
export let basicRefused = false;
/** Whether the metadata offers RFC 7009 revocation, as inbuxa-server 27.1 does. */
export let revocationOffered = true;

/** For tests: how long new access tokens last, and a way to end every token. */
export const oauthMock = {
  setAccessTokenTtl(seconds: number) { accessTokenTtl = seconds; },
  expireAccessTokens() { for (const t of accessTokens.values()) t.expiresAt = 0; },
  refuseBasic(on: boolean) { basicRefused = on; },
  offerRevocation(on: boolean) { revocationOffered = on; },
  /** Tokens revoked so far, by RFC 7009. */
  revoked: [] as string[],
  reset() { codes.clear(); accessTokens.clear(); refreshTokens.clear(); accessTokenTtl = 3600; basicRefused = false; revocationOffered = true; oauthMock.revoked.length = 0; },
};

/** A bearer token the mock issued, still valid under the current password. */
export function checkBearer(header: string): boolean {
  if (!header.startsWith("Bearer ")) return false;
  const t = accessTokens.get(header.slice(7));
  return Boolean(t && t.expiresAt > Date.now() && t.password === account.password);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(new URLSearchParams(Buffer.concat(chunks).toString())));
  });
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function issue(res: ServerResponse, refresh: string | null) {
  const access = `mock-at-${randomBytes(16).toString("hex")}`;
  accessTokens.set(access, { password: account.password, expiresAt: Date.now() + accessTokenTtl * 1000 });
  const body: Record<string, unknown> = { access_token: access, token_type: "bearer", expires_in: accessTokenTtl };
  if (!refresh) {
    const fresh = `mock-rt-${randomBytes(16).toString("hex")}`;
    refreshTokens.set(fresh, { password: account.password });
    body.refresh_token = fresh;
  }
  return json(res, 200, body);
}

/** Handles the OAuth routes; false for anything else. */
export async function handleOAuth(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname === "/.well-known/oauth-authorization-server" && req.method === "GET") {
    json(res, 200, {
      issuer: base(),
      authorization_endpoint: `${base()}/login`,
      token_endpoint: `${base()}/auth/token`,
      ...(revocationOffered ? { revocation_endpoint: `${base()}/auth/revoke` } : {}),
      grant_types_supported: ["authorization_code", "refresh_token"],
      response_types_supported: ["code"],
      scopes_supported: ["openid", "offline_access"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
      code_challenge_methods_supported: ["S256"],
    });
    return true;
  }
  if (url.pathname === "/login" && req.method === "GET") {
    const q = url.searchParams;
    const redirectUri = q.get("redirect_uri") ?? "";
    if (q.get("client_id") !== OAUTH_CLIENT_ID || q.get("response_type") !== "code" || !redirectUri || q.get("code_challenge_method") !== "S256") {
      json(res, 400, { error: "invalid_request" });
      return true;
    }
    const code = randomBytes(16).toString("hex");
    codes.set(code, { challenge: q.get("code_challenge") ?? "", redirectUri, issuedAt: Date.now() });
    const back = new URL(redirectUri);
    back.searchParams.set("code", code);
    back.searchParams.set("state", q.get("state") ?? "");
    res.writeHead(302, { location: back.toString() });
    res.end();
    return true;
  }
  if (url.pathname === "/api/auth" && req.method === "POST") {
    // The server's sign-in page posts here; the mock answers for the demo user.
    let body: Record<string, unknown>;
    try {
      body = JSON.parse((await readBody(req)).toString()) as Record<string, unknown>;
    } catch {
      json(res, 400, { error: "invalid_request" });
      return true;
    }
    const redirectUri = typeof body.redirectUri === "string" ? body.redirectUri : "";
    if (body.type !== "authCode" || body.clientId !== OAUTH_CLIENT_ID || !redirectUri || body.codeChallengeMethod !== "S256") {
      json(res, 400, { error: "invalid_request" });
      return true;
    }
    const secret = typeof body.accountSecret === "string" ? body.accountSecret : "";
    const passwordOk = body.accountName === USER && (secret === account.password || account.appPasswords.some((a) => a.secret === secret));
    if (!passwordOk) {
      json(res, 200, { type: "failure" });
      return true;
    }
    if (account.otpUrl && secret === account.password && !body.mfaToken) {
      json(res, 200, { type: "mfaRequired" });
      return true;
    }
    const code = randomBytes(16).toString("hex");
    codes.set(code, { challenge: String(body.codeChallenge ?? ""), redirectUri, issuedAt: Date.now() });
    json(res, 200, { type: "authenticated", client_code: code, iss: base() });
    return true;
  }
  if (url.pathname === "/auth/revoke" && req.method === "POST" && revocationOffered) {
    // RFC 7009: this client's secret, then the token goes, whatever it was
    const form = await readForm(req);
    if (form.get("client_id") !== OAUTH_CLIENT_ID || form.get("client_secret") !== OAUTH_CLIENT_SECRET) {
      json(res, 401, { error: "invalid_client" });
      return true;
    }
    const token = form.get("token") ?? "";
    if (accessTokens.delete(token) || refreshTokens.delete(token)) oauthMock.revoked.push(token);
    res.writeHead(200);
    res.end();
    return true;
  }
  if (url.pathname === "/auth/token" && req.method === "POST") {
    const form = await readForm(req);
    if (form.get("client_id") !== OAUTH_CLIENT_ID || form.get("client_secret") !== OAUTH_CLIENT_SECRET) {
      json(res, 400, { error: "invalid_client" });
      return true;
    }
    if (form.get("grant_type") === "authorization_code") {
      const code = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (!code || code.challenge !== challenge || code.redirectUri !== form.get("redirect_uri") || Date.now() - code.issuedAt > 600_000) {
        json(res, 400, { error: "invalid_grant" });
        return true;
      }
      issue(res, null);
      return true;
    }
    if (form.get("grant_type") === "refresh_token") {
      const refresh = form.get("refresh_token") ?? "";
      const grant = refreshTokens.get(refresh);
      if (!grant || grant.password !== account.password) {
        json(res, 400, { error: "invalid_grant" });
        return true;
      }
      issue(res, refresh);
      return true;
    }
    json(res, 400, { error: "unsupported_grant_type" });
    return true;
  }
  return false;
}

/** The username the mock signs in, for tests. */
export const OAUTH_USER = USER;
