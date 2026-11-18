import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * inbuxa K-W2: signing out revokes the session's tokens at the server. With
 * cookie sessions there is nothing on this side to delete, so the revocation
 * is what makes a copy of the cookie stop working.
 */

const PORT = 18821;
process.env.MOCK_PORT = String(PORT);
process.env.MOCK_USER = "demo@example.com";
process.env.MOCK_PASS = "demo-password";
process.env.MAIL_SERVER_URL = `http://127.0.0.1:${PORT}`;
process.env.APP_SECRET = "test-secret-for-signout-revoke";
process.env.OAUTH_CLIENT_SECRET = "mock-oauth-secret";
process.env.PUBLIC_URL = "https://webmail.example.test";
process.env.SESSION_BACKEND = "cookie";

const mock = await import("./mock/index.js");
const { oauthMock } = await import("./mock/oauth.js");
const { createApp, sessions } = await import("./app.js");
const { resetOAuthState } = await import("./oauth.js");

const app = createApp();

async function call(path: string, cookie?: string, init: RequestInit = {}) {
  return app.request(path, {
    ...init,
    headers: { "content-type": "application/json", "x-requested-with": "ihasmail", ...(cookie ? { cookie } : {}) },
  });
}

function cookieFrom(res: Response, name: string): string | undefined {
  for (const header of res.headers.getSetCookie()) {
    const pair = header.split(";")[0]!;
    if (pair.startsWith(`${name}=`)) return pair.slice(name.length + 1) || undefined;
  }
  return undefined;
}

/** Sign in on the mock's page; returns the session cookie as a Cookie header. */
async function signIn(): Promise<string> {
  const start = await call("/api/auth/oauth/start?username=demo%40example.com&remember=1");
  assert.equal(start.status, 302);
  const state = cookieFrom(start, "ihm_session_signin");
  const approved = await fetch(new URL(start.headers.get("location")!), { redirect: "manual" });
  const back = new URL(approved.headers.get("location")!);
  const res = await call(`/api/auth/callback${back.search}`, state ? `ihm_session_signin=${state}` : undefined);
  assert.equal(res.status, 302);
  const session = cookieFrom(res, "ihm_session");
  assert.ok(session, "a session cookie was set");
  assert.ok(session!.startsWith("s1."), "a sealed cookie session");
  return `ihm_session=${session}`;
}

beforeEach(() => {
  oauthMock.reset();
  resetOAuthState();
});

after(() => {
  (mock as { server?: { close(): void } }).server?.close();
});

test("after sign-out, a copy of the old cookie gets 401", async () => {
  assert.equal(sessions.enumerable, false, "cookie sessions");
  const copy = await signIn();
  assert.equal((await call("/api/auth/session", copy)).status, 200);

  const out = await call("/api/auth/logout", copy, { method: "POST" });
  assert.equal(out.status, 200);
  assert.equal(oauthMock.revoked.length, 2, "the refresh and the access token were revoked");

  assert.equal((await call("/api/auth/session", copy)).status, 401, "the copied cookie is dead");
});

test("signing out of every account revokes each one's tokens", async () => {
  const copy = await signIn();
  const out = await call("/api/auth/logout-all", copy, { method: "POST" });
  assert.equal(out.status, 200);
  assert.equal(oauthMock.revoked.length, 2);
  assert.equal((await call("/api/auth/session", copy)).status, 401);
});

test("a server without revocation still signs out", async () => {
  oauthMock.offerRevocation(false);
  const copy = await signIn();
  const out = await call("/api/auth/logout", copy, { method: "POST" });
  assert.equal(out.status, 200, "sign-out doesn't fail");
  assert.equal(oauthMock.revoked.length, 0);
  // What revocation is for: without it, the copy works until its tokens expire
  assert.equal((await call("/api/auth/session", copy)).status, 200);
});
