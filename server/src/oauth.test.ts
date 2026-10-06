import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Signing in on the mail server's own page, end to end against the mock's
 * OAuth side: the redirect out, the callback, the session holding tokens
 * instead of a password, token renewal, and what ends a session.
 */

const PORT = 18811;
process.env.MOCK_PORT = String(PORT);
process.env.MOCK_USER = "demo@example.com";
process.env.MOCK_PASS = "demo-password";
process.env.MAIL_SERVER_URL = `http://127.0.0.1:${PORT}`;
process.env.APP_SECRET = "test-secret-for-oauth";
process.env.OAUTH_CLIENT_SECRET = "mock-oauth-secret";
process.env.PUBLIC_URL = "https://webmail.example.test";

const mock = await import("./mock/index.js");
const { oauthMock } = await import("./mock/oauth.js");
const { createApp, pushCredential, sessions } = await import("./app.js");
const { resetOAuthState } = await import("./oauth.js");

const app = createApp();
const CALLBACK = "https://webmail.example.test/api/auth/callback";

/** A cookie jar, since sign-in sets two cookies on different paths. */
let jar = new Map<string, string>();

function keepCookies(res: Response) {
  for (const header of res.headers.getSetCookie()) {
    const [pair, ...attrs] = header.split(";");
    const [name, value] = [pair!.slice(0, pair!.indexOf("=")), pair!.slice(pair!.indexOf("=") + 1)];
    const expired = attrs.some((a) => /max-age=0\b/i.test(a.trim()) || /expires=thu, 01 jan 1970/i.test(a.trim()));
    if (expired || value === "") jar.delete(name);
    else jar.set(name, value);
  }
}

async function call(path: string, init: RequestInit = {}) {
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await app.request(path, {
    ...init,
    headers: { "content-type": "application/json", "x-requested-with": "ihasmail", ...(cookie ? { cookie } : {}), ...(init.headers as Record<string, string>) },
  });
  keepCookies(res);
  return res;
}

async function jsonOf(res: Response) {
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Leave for the server's page and come back: returns the callback URL. */
async function goToServerAndBack(username = "demo@example.com"): Promise<URL> {
  const start = await call(`/api/auth/oauth/start?username=${encodeURIComponent(username)}&remember=1`);
  assert.equal(start.status, 302);
  const signInPage = new URL(start.headers.get("location")!);
  const approved = await fetch(signInPage, { redirect: "manual" });
  assert.equal(approved.status, 302, "the mock's page approves the demo user");
  return new URL(approved.headers.get("location")!);
}

async function signIn() {
  const back = await goToServerAndBack();
  const res = await call(`/api/auth/callback${back.search}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");
  assert.ok(jar.get("ihm_session"), "a session cookie was set");
}

beforeEach(() => {
  jar = new Map();
  oauthMock.reset();
  resetOAuthState();
});

before(() => {});
after(() => {
  (mock as { server?: { close(): void } }).server?.close();
});

test("the configuration tells the web app to use the server's page", async () => {
  const body = await jsonOf(await call("/api/config"));
  assert.equal(body.signIn, "oauth");
  assert.equal(body.signInDirect, true, "one mail server: its page asks for the username, not ihasmail");
});

test("with one mail server, sign-in starts without an address", async () => {
  const res = await call("/api/auth/oauth/start");
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get("location")!);
  assert.equal(to.searchParams.has("login_hint"), false);
  const approved = await fetch(to, { redirect: "manual" });
  const back = new URL(approved.headers.get("location")!);
  assert.equal((await call(`/api/auth/callback${back.search}`)).headers.get("location"), "/");
  assert.equal((await call("/api/auth/session")).status, 200);
});

test("the password form is refused: ihasmail never sees a password", async () => {
  const res = await call("/api/auth/login", { method: "POST", body: JSON.stringify({ username: "demo@example.com", password: "demo-password" }) });
  assert.equal(res.status, 403);
  assert.equal((await jsonOf(res)).error, "oauth_required");
});

test("start sends the browser to the server's page with PKCE and a bound state", async () => {
  const res = await call("/api/auth/oauth/start?username=demo@example.com");
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get("location")!);
  assert.equal(`${to.origin}${to.pathname}`, `http://127.0.0.1:${PORT}/login`);
  assert.equal(to.searchParams.get("client_id"), "ihasmail-inbuxa");
  assert.equal(to.searchParams.get("redirect_uri"), CALLBACK);
  assert.equal(to.searchParams.get("response_type"), "code");
  assert.equal(to.searchParams.get("code_challenge_method"), "S256");
  assert.match(to.searchParams.get("code_challenge") ?? "", /^[\w-]{43}$/);
  assert.equal(to.searchParams.get("login_hint"), "demo@example.com");
  assert.equal(to.searchParams.get("scope"), "openid offline_access");
  assert.equal(jar.get("ihm_session_signin"), to.searchParams.get("state"), "the state is bound to this browser");
});

test("a full sign-in holds tokens, and the session works", async () => {
  await signIn();
  const res = await call("/api/auth/session");
  assert.equal(res.status, 200);
  const body = await jsonOf(res);
  assert.equal(body.ihasmail.loginName, "demo@example.com");
  assert.equal(jar.get("ihm_session_signin"), undefined, "the state cookie is cleared");
});

test("the callback comes back cross-site, and is still accepted", async () => {
  const back = await goToServerAndBack();
  const res = await call(`/api/auth/callback${back.search}`, { headers: { "sec-fetch-site": "cross-site" } });
  assert.equal(res.headers.get("location"), "/");
});

test("a callback from a sign-in this browser didn't start is refused", async () => {
  const back = await goToServerAndBack();
  jar.delete("ihm_session_signin");
  const res = await call(`/api/auth/callback${back.search}`);
  assert.equal(res.headers.get("location"), "/?signin_error=state_mismatch");
  assert.equal(jar.get("ihm_session"), undefined);
});

test("a state is good for one attempt", async () => {
  const back = await goToServerAndBack();
  const state = jar.get("ihm_session_signin")!;
  await call(`/api/auth/callback${back.search}`);
  jar = new Map([["ihm_session_signin", state]]);
  const again = await call(`/api/auth/callback${back.search}`);
  assert.equal(again.headers.get("location"), "/?signin_error=state_mismatch");
});

test("cancelling on the server's page comes back as an error, not a session", async () => {
  await call("/api/auth/oauth/start?username=demo@example.com");
  const state = jar.get("ihm_session_signin")!;
  const res = await call(`/api/auth/callback?error=access_denied&state=${state}`);
  assert.equal(res.headers.get("location"), "/?signin_error=cancelled");
  assert.equal(jar.get("ihm_session"), undefined);
});

test("a code the server won't exchange is refused", async () => {
  const back = await goToServerAndBack();
  back.searchParams.set("code", "not-a-code");
  const res = await call(`/api/auth/callback${back.search}`);
  assert.equal(res.headers.get("location"), "/?signin_error=exchange_failed");
});

test("an access token about to expire is renewed without the person noticing", async () => {
  oauthMock.setAccessTokenTtl(60); // inside the renewal margin from the start
  await signIn();
  oauthMock.expireAccessTokens(); // the one the session holds is now dead upstream
  const res = await call("/api/auth/session?refresh=1");
  assert.equal(res.status, 200, "renewed before the call went upstream");
});

test("renewal refused by the server ends the session", async () => {
  await signIn();
  const cookie = jar.get("ihm_session")!;
  const session = sessions.resolve(cookie)!;
  // Pretend the token is about to expire, then make the server refuse to renew it.
  sessions.updateTokens(cookie, { ...session.tokens!, expiresAt: Date.now() + 1000, refresh: "revoked" });
  const res = await call("/api/auth/session");
  assert.equal(res.status, 401);
  assert.equal(jar.get("ihm_session"), undefined, "and the cookie is cleared");
});

test("a password change signs the session out, since the server revokes its tokens", async () => {
  await signIn();
  const res = await call("/api/account/password", { method: "POST", body: JSON.stringify({ current: "demo-password", next: "new-password-123" }) });
  assert.equal(res.status, 200);
  assert.equal((await jsonOf(res)).signedOut, true);
  assert.equal((await call("/api/auth/session")).status, 401);
  // Put it back for the tests after this one.
  const { account } = await import("./mock/config.js");
  account.password = "demo-password";
});

test("creating an app password checks the typed password with the server", async () => {
  await signIn();
  // As INBUXA's server does: no password over JMAP (contract C-23).
  oauthMock.refuseBasic(true);
  const wrong = await call("/api/account/app-passwords", { method: "POST", body: JSON.stringify({ description: "Phone", current: "nope" }) });
  assert.equal(wrong.status, 403);
  const right = await call("/api/account/app-passwords", { method: "POST", body: JSON.stringify({ description: "Phone", current: "demo-password" }) });
  assert.equal(right.status, 200);
});

test("push keeps a credential that renews itself", async () => {
  oauthMock.setAccessTokenTtl(60);
  await signIn();
  const session = sessions.resolve(jar.get("ihm_session"))!;
  const credential = pushCredential(session);
  const first = await credential.get();
  oauthMock.expireAccessTokens();
  const second = await credential.get();
  assert.notEqual(second, first, "a fresh access token");
  assert.match(second, /^Bearer mock-at-/);
});

test("inbuxa MA-B: adding an account asks the server's page to sign in again", async () => {
  // With nobody in front, add=1 is an ordinary sign-in
  let res = await call("/api/auth/oauth/start?username=demo@example.com&add=1");
  assert.equal(new URL(res.headers.get("location")!).searchParams.has("prompt"), false);

  await signIn();
  res = await call("/api/auth/oauth/start?username=demo@example.com&add=1");
  assert.equal(res.status, 302);
  const signInPage = new URL(res.headers.get("location")!);
  assert.equal(signInPage.searchParams.get("prompt"), "login", "the server's page must not reuse the first sign-in");

  // The mock's page signs the same account in again: it stays one account
  const approved = await fetch(signInPage, { redirect: "manual" });
  const back = new URL(approved.headers.get("location")!);
  res = await call(`/api/auth/callback${back.search}`);
  assert.equal(res.headers.get("location"), "/");
  const list = await jsonOf(await call("/api/auth/accounts"));
  assert.deepEqual(list.accounts.map((a: { username: string }) => a.username), ["demo@example.com"]);
});
