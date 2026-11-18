import { test } from "node:test";
import assert from "node:assert/strict";
import { CookieSessionStore, SessionStore } from "./sessions.js";
import { parseOthers, serializeOthers } from "./accounts.js";

// Realistic sizes: server tokens are sealed structs of about 100 characters.
const tokens = { access: "a".repeat(110), refresh: "r".repeat(110), expiresAt: Date.now() + 3600_000 };
const params = { username: "alice@example.com", account: "https://mail.example.com alice@example.com", tokens, remember: true, userAgent: "Mozilla/5.0 ".repeat(20), ip: "192.0.2.1" };

test("cookie sessions resolve on any replica holding the same secret", () => {
  const a = new CookieSessionStore("shared-secret");
  const b = new CookieSessionStore("shared-secret");
  const { cookie, session } = a.create(params);
  const live = b.resolve(cookie);
  assert.ok(live);
  assert.equal(live!.id, session.id);
  assert.equal(live!.authorization, `Bearer ${tokens.access}`);
  assert.equal(live!.account, params.account);
  assert.equal(new CookieSessionStore("another-secret").resolve(cookie), null);
});

test("cookie sessions refuse tampered, foreign and expired cookies", () => {
  const store = new CookieSessionStore("s");
  const { cookie } = store.create(params);
  const [v, kid, sealed] = cookie.split(".");
  assert.equal(store.resolve(`${v}.${kid}.${sealed!.slice(0, -2)}AA`), null);
  assert.equal(store.resolve(`s2.${kid}.${sealed}`), null);
  assert.equal(store.resolve(`${cookie}.x`), null);
  assert.equal(store.resolve(undefined), null);
  const expired = new CookieSessionStore("s");
  const old = expired.create({ ...params, remember: false });
  const real = Date.now;
  try {
    Date.now = () => real() + 13 * 3600_000;
    assert.equal(expired.resolve(old.cookie), null);
  } finally {
    Date.now = real;
  }
});

test("a cookie session stays small enough for five accounts", () => {
  const { cookie } = new CookieSessionStore("s").create(params);
  // The user agent and IP aren't carried: nothing lists them in this mode.
  assert.ok(cookie.length < 900, `cookie is ${cookie.length} bytes`);
  const others = Array.from({ length: 4 }, () => new CookieSessionStore("s").create(params).cookie);
  const value = serializeOthers(others);
  assert.ok(value.length < 3800);
  assert.deepEqual(parseOthers(value), others);
});

test("renewed tokens and sliding expiry re-issue the cookie", () => {
  const store = new CookieSessionStore("s");
  const { cookie } = store.create(params);
  assert.equal(store.touch(cookie), null, "fresh cookie stays");
  const renewed = { ...tokens, access: "b".repeat(110) };
  const next = store.updateTokens(cookie, renewed);
  assert.ok(next && next !== cookie);
  assert.equal(store.resolve(next!)!.authorization, `Bearer ${renewed.access}`);
  const real = Date.now;
  try {
    Date.now = () => real() + 120_000;
    const slid = store.touch(next!);
    assert.ok(slid);
    assert.ok(store.resolve(slid!)!.expiresAt > store.resolve(next!)!.expiresAt);
  } finally {
    Date.now = real;
  }
});

test("rotating APP_SECRET: old cookies open and are re-sealed under the new key", () => {
  const before = new CookieSessionStore("old");
  const { cookie } = before.create(params);
  const after = new CookieSessionStore("new", ["old"]);
  assert.ok(after.resolve(cookie));
  const resealed = after.touch(cookie);
  assert.ok(resealed && resealed.split(".")[1] !== cookie.split(".")[1]);
  assert.ok(new CookieSessionStore("new").resolve(resealed!));
  assert.equal(new CookieSessionStore("new").resolve(cookie), null);
});

test("cookie sessions hold OAuth tokens only and can't enumerate", () => {
  const store = new CookieSessionStore("s");
  assert.throws(() => store.create({ username: "u", password: "p", remember: false, userAgent: "", ip: "" }));
  assert.equal(store.enumerable, false);
  assert.equal(store.reseal("x", "p"), false);
  assert.deepEqual(store.listForUser("u"), []);
  assert.equal(store.destroyAllForUser("u"), 0);
  assert.equal(new SessionStore("").enumerable, true);
});

test("the memory store keeps its cookie across a token renewal", () => {
  const store = new SessionStore("");
  const { cookie } = store.create(params);
  assert.equal(store.updateTokens(cookie, { ...tokens, access: "c" }), cookie);
  assert.equal(store.touch(cookie), null);
});
