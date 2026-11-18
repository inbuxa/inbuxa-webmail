import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { cookieKey, deriveKey, open, randomToken, safeEqual, seal, sha256 } from "./crypto.js";
import type { TokenSet } from "./oauth.js";

export interface StoredSession {
  id: string;
  /** sha256 of the cookie secret; used to validate presented cookies. */
  secretHash: string;
  /** base64 random salt for key derivation */
  salt: string;
  /** sealed JSON: `{u, p}` for a password, `{u, t}` for OAuth tokens (see oauth.ts) */
  sealedCredentials: string;
  username: string;
  /** Which account this is; see `accountKey`. Absent on sessions saved before it existed. */
  account?: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  remember: boolean;
  userAgent: string;
  ip: string;
}

export interface LiveSession {
  id: string;
  username: string;
  /** See `accountKey`. */
  account: string;
  /** Authorization header value for upstream calls: Basic, or Bearer for OAuth. */
  authorization: string;
  /** The OAuth tokens behind `authorization`, or null for a password session. */
  tokens: TokenSet | null;
  remember: boolean;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  userAgent: string;
  ip: string;
}

/** What `/api/auth/sessions` reports about a session, with nothing secret in it. */
export interface SessionSummary {
  id: string;
  username: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  remember: boolean;
  userAgent: string;
  ip: string;
}

/**
 * The key sessions are grouped by for "sign out everywhere else".
 *
 * Not the username as typed: Stalwart takes `Alice@example.com` and a bare
 * `alice` as the same account, and a session opened either way was missing
 * from the list and survived the sign-out. The server's own name for the
 * account, lower-cased, and the server it lives on -- the same name on two
 * configured servers is two accounts.
 */
export function accountKey(upstream: string, canonicalUsername: string): string {
  return `${upstream}|${canonicalUsername.trim().toLowerCase()}`;
}

function accountOf(s: StoredSession): string {
  return s.account ?? s.username.trim().toLowerCase();
}

export interface CreateSessionParams {
  username: string;
  /** From `accountKey`; defaults to the lower-cased username. */
  account?: string;
  /** Exactly one of `password` and `tokens`. */
  password?: string;
  tokens?: TokenSet;
  remember: boolean;
  userAgent: string;
  ip: string;
}

/**
 * Everything the rest of the server asks of a session store.
 *
 * There is one implementation today -- `SessionStore` below, which keeps the
 * records in memory and optionally mirrors them to `SESSION_FILE`. The reason
 * it is named as an interface anyway is that a second one is planned: a
 * stateless backend that carries the whole record in the cookie, so that a
 * replica can serve a session it never issued and `/data` can go away. Callers
 * written against the concrete class would all have to be revisited then.
 *
 * Five of these are already stateless in shape -- `create`, `resolve`,
 * `reseal` and `destroy` each touch exactly one session, and the sealing key is
 * derived from the cookie secret (see `crypto.ts`), so the record can move into
 * the cookie without the server keeping a map.
 *
 * The other two cannot be. `listForUser` and `destroyAllForUser` have to reach
 * sessions other than the one presenting itself, which means something has to
 * be enumerable somewhere. `destroyAllForUser` is not only the "sign out my
 * other sessions" button: `app.ts` also calls it when the password or the app
 * password changes, so it carries the guarantee that changing a credential
 * invalidates the sessions still holding the old one. A stateless backend
 * cannot honor that alone; the plan is for OAuth to hand the job to
 * Stalwart's own token registry, which can already answer both questions.
 */
export interface SessionBackend {
  /**
   * Whether `listForUser` and `destroyAllForUser` can reach sessions other
   * than the one presenting itself. False for the cookie backend.
   */
  readonly enumerable: boolean;
  init(): Promise<void>;
  close(): Promise<void>;
  create(params: CreateSessionParams): { cookie: string; session: LiveSession };
  resolve(cookie: string | undefined): LiveSession | null;
  reseal(cookie: string | undefined, password: string): boolean;
  /**
   * Store renewed OAuth tokens in place of the ones the session holds. Returns
   * the cookie to use from now on (the same one, for a backend that keeps the
   * record itself), or null when the cookie doesn't resolve.
   */
  updateTokens(cookie: string | undefined, tokens: TokenSet): string | null;
  /**
   * A new cookie to send, when the backend wants this one re-issued (the
   * cookie backend's sliding expiry, or a cookie sealed under a retired key).
   * Null when the cookie stays as it is.
   */
  touch(cookie: string | undefined): string | null;
  destroy(id: string): void;
  /** `account` is an `accountKey`, as carried on `LiveSession.account`. */
  destroyAllForUser(account: string, exceptId?: string): number;
  listForUser(account: string): SessionSummary[];
}

const COOKIE_SEP = ".";

/** What a session seals: a password, or OAuth tokens. */
type Sealed = { u: string; p: string } | { u: string; t: TokenSet };

function sealable(username: string, params: { password?: string; tokens?: TokenSet }): Sealed {
  if (params.tokens) return { u: username, t: params.tokens };
  if (params.password !== undefined) return { u: username, p: params.password };
  throw new Error("a session needs a password or tokens");
}

export class SessionStore implements SessionBackend {
  readonly enumerable = true;
  private sessions = new Map<string, StoredSession>();
  private dirty = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    if (this.file) {
      try {
        const raw = await readFile(this.file, "utf8");
        const arr = JSON.parse(raw) as StoredSession[];
        const now = Date.now();
        for (const s of arr) if (s.expiresAt > now) this.sessions.set(s.id, s);
        console.log(`[ihasmail] restored ${this.sessions.size} session(s)`);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn("[ihasmail] could not read session file:", (err as Error).message);
        }
      }
    }
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
    this.sweepTimer.unref();
  }

  async close(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    await this.flush();
  }

  private sweep(): void {
    const now = Date.now();
    let removed = 0;
    for (const [id, s] of this.sessions) {
      if (s.expiresAt <= now) {
        this.sessions.delete(id);
        removed++;
      }
    }
    if (removed) this.scheduleSave();
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, 1000);
    this.saveTimer.unref();
  }

  private async flush(): Promise<void> {
    if (!this.file || !this.dirty) return;
    this.dirty = false;
    try {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify([...this.sessions.values()]), { mode: 0o600 });
      await rename(tmp, this.file);
    } catch (err) {
      console.warn("[ihasmail] could not persist sessions:", (err as Error).message);
    }
  }

  /** Create a session; returns the cookie value to hand to the client. */
  create(params: CreateSessionParams): { cookie: string; session: LiveSession } {
    const id = randomToken(18);
    const secret = randomToken(32);
    const salt = randomBytes(16);
    const key = deriveKey(secret, config.appSecret, salt);
    const now = Date.now();
    const ttl = (params.remember ? config.sessionRememberTtl : config.sessionTtl) * 1000;
    const stored: StoredSession = {
      id,
      secretHash: sha256(secret),
      salt: salt.toString("base64"),
      sealedCredentials: seal(JSON.stringify(sealable(params.username, params)), key),
      username: params.username,
      account: params.account ?? params.username.trim().toLowerCase(),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + ttl,
      remember: params.remember,
      userAgent: params.userAgent.slice(0, 200),
      ip: params.ip,
    };
    this.sessions.set(id, stored);
    this.scheduleSave();
    const cookie = `${id}${COOKIE_SEP}${secret}`;
    return { cookie, session: this.toLive(stored, sealable(params.username, params)) };
  }

  /** Resolve a cookie to a live session (with decrypted upstream credentials). */
  resolve(cookie: string | undefined): LiveSession | null {
    if (!cookie) return null;
    const idx = cookie.indexOf(COOKIE_SEP);
    if (idx <= 0) return null;
    const id = cookie.slice(0, idx);
    const secret = cookie.slice(idx + 1);
    const stored = this.sessions.get(id);
    if (!stored) return null;
    const now = Date.now();
    if (stored.expiresAt <= now) {
      this.sessions.delete(id);
      this.scheduleSave();
      return null;
    }
    if (!safeEqual(stored.secretHash, sha256(secret))) return null;
    const key = deriveKey(secret, config.appSecret, Buffer.from(stored.salt, "base64"));
    const json = open(stored.sealedCredentials, key);
    if (!json) return null;
    let creds: Sealed;
    try {
      creds = JSON.parse(json) as Sealed;
    } catch {
      return null;
    }
    // Sliding expiry: bump every few minutes, not on every request.
    if (now - stored.lastSeenAt > 60_000) {
      stored.lastSeenAt = now;
      const ttl = (stored.remember ? config.sessionRememberTtl : config.sessionTtl) * 1000;
      stored.expiresAt = now + ttl;
      this.scheduleSave();
    }
    return this.toLive(stored, creds);
  }

  /**
   * Re-seal this session's stored credentials.
   *
   * The upstream password is what every proxied call authenticates with, so a
   * password change (or swapping in an app password when 2FA is switched on)
   * would otherwise leave the session holding a credential the server no
   * longer accepts. Needs the cookie: the sealing key is derived from the
   * secret half of it, which the server never keeps.
   */
  reseal(cookie: string | undefined, password: string): boolean {
    return this.rewrite(cookie, (username) => ({ u: username, p: password }));
  }

  updateTokens(cookie: string | undefined, tokens: TokenSet): string | null {
    return this.rewrite(cookie, (username) => ({ u: username, t: tokens })) ? cookie! : null;
  }

  /** Expiry slides in `resolve`, and the cookie itself never changes. */
  touch(_cookie: string | undefined): string | null {
    return null;
  }

  private rewrite(cookie: string | undefined, next: (username: string) => Sealed): boolean {
    if (!cookie) return false;
    const idx = cookie.indexOf(COOKIE_SEP);
    if (idx <= 0) return false;
    const id = cookie.slice(0, idx);
    const secret = cookie.slice(idx + 1);
    const stored = this.sessions.get(id);
    if (!stored) return false;
    if (!safeEqual(stored.secretHash, sha256(secret))) return false;
    const key = deriveKey(secret, config.appSecret, Buffer.from(stored.salt, "base64"));
    stored.sealedCredentials = seal(JSON.stringify(next(stored.username)), key);
    this.scheduleSave();
    return true;
  }

  destroy(id: string): void {
    if (this.sessions.delete(id)) this.scheduleSave();
  }

  destroyAllForUser(account: string, exceptId?: string): number {
    let n = 0;
    for (const [id, s] of this.sessions) {
      if (accountOf(s) === account && id !== exceptId) {
        this.sessions.delete(id);
        n++;
      }
    }
    if (n) this.scheduleSave();
    return n;
  }

  listForUser(account: string): SessionSummary[] {
    const out = [];
    for (const s of this.sessions.values()) {
      if (accountOf(s) !== account) continue;
      const { secretHash: _h, salt: _s, sealedCredentials: _c, account: _a, ...rest } = s;
      out.push(rest);
    }
    return out;
  }

  private toLive(s: StoredSession, creds: Sealed): LiveSession {
    const username = creds.u;
    return {
      id: s.id,
      username,
      account: accountOf(s),
      authorization: "t" in creds
        ? `Bearer ${creds.t.access}`
        : `Basic ${Buffer.from(`${username}:${creds.p}`, "utf8").toString("base64")}`,
      tokens: "t" in creds ? creds.t : null,
      remember: s.remember,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      userAgent: s.userAgent,
      ip: s.ip,
    };
  }
}

/*
 * inbuxa K-W1: sessions carried whole in the cookie, so that any replica can
 * serve a session it never issued and the webmail keeps no state of its own.
 *
 * The cookie is `s1.<kid>.<sealed>`: the record below sealed with AES-256-GCM
 * under a key derived from APP_SECRET (`cookieKey`), `kid` naming that key.
 * APP_SECRET_PREVIOUS keys still open cookies, and a cookie opened with one is
 * re-sealed under the current key on its next request (`touch`).
 *
 * What it can't do, by construction: list a user's other sessions or end
 * them, so `enumerable` is false and the UI hides both. Ending this session is
 * deleting the cookie; the server revokes the tokens behind every session when
 * the password changes. Password sessions aren't offered at all (config.ts
 * refuses cookie mode without OAuth): a sealed password couldn't be revoked.
 */
const COOKIE_V1 = "s1";

/** The sealed record. Short keys: it travels on every request. */
interface CookieRecord {
  i: string; // session id
  u: string; // username
  a: string; // accountKey
  t: TokenSet;
  c: number; // createdAt
  l: number; // lastSeenAt
  e: number; // expiresAt
  r: boolean; // remember
}

export class CookieSessionStore implements SessionBackend {
  readonly enumerable = false;
  private readonly keys: { kid: string; key: Buffer }[];

  constructor(appSecret: string, previous: string[] = []) {
    this.keys = [appSecret, ...previous].map(cookieKey);
  }

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  create(params: CreateSessionParams): { cookie: string; session: LiveSession } {
    if (!params.tokens) throw new Error("cookie sessions hold OAuth tokens only");
    const now = Date.now();
    const record: CookieRecord = {
      i: randomToken(18),
      u: params.username,
      a: params.account ?? params.username.trim().toLowerCase(),
      t: params.tokens,
      c: now,
      l: now,
      e: now + this.ttl(params.remember),
      r: params.remember,
    };
    return { cookie: this.seal(record), session: this.toLive(record) };
  }

  resolve(cookie: string | undefined): LiveSession | null {
    const opened = this.open(cookie);
    return opened ? this.toLive(opened.record) : null;
  }

  touch(cookie: string | undefined): string | null {
    const opened = this.open(cookie);
    if (!opened) return null;
    const now = Date.now();
    const stale = now - opened.record.l > 60_000;
    if (!stale && opened.current) return null;
    if (stale) {
      opened.record.l = now;
      opened.record.e = now + this.ttl(opened.record.r);
    }
    return this.seal(opened.record);
  }

  /** Cookie sessions hold no password to re-seal. */
  reseal(_cookie: string | undefined, _password: string): boolean {
    return false;
  }

  updateTokens(cookie: string | undefined, tokens: TokenSet): string | null {
    const opened = this.open(cookie);
    if (!opened) return null;
    opened.record.t = tokens;
    return this.seal(opened.record);
  }

  /** Nothing is kept here: the caller deletes the cookie. */
  destroy(_id: string): void {}

  destroyAllForUser(_account: string, _exceptId?: string): number {
    return 0;
  }

  listForUser(_account: string): SessionSummary[] {
    return [];
  }

  private ttl(remember: boolean): number {
    return (remember ? config.sessionRememberTtl : config.sessionTtl) * 1000;
  }

  private seal(record: CookieRecord): string {
    const { kid, key } = this.keys[0]!;
    return `${COOKIE_V1}${COOKIE_SEP}${kid}${COOKIE_SEP}${seal(JSON.stringify(record), key)}`;
  }

  private open(cookie: string | undefined): { record: CookieRecord; current: boolean } | null {
    if (!cookie) return null;
    const [version, kid, sealed, extra] = cookie.split(COOKIE_SEP);
    if (version !== COOKIE_V1 || !kid || !sealed || extra !== undefined) return null;
    const at = this.keys.findIndex((k) => k.kid === kid);
    if (at < 0) return null;
    const json = open(sealed, this.keys[at]!.key);
    if (!json) return null;
    let record: CookieRecord;
    try {
      record = JSON.parse(json) as CookieRecord;
    } catch {
      return null;
    }
    if (typeof record.e !== "number" || record.e <= Date.now() || !record.t?.access) return null;
    return { record, current: at === 0 };
  }

  private toLive(r: CookieRecord): LiveSession {
    return {
      id: r.i,
      username: r.u,
      account: r.a,
      authorization: `Bearer ${r.t.access}`,
      tokens: r.t,
      remember: r.r,
      createdAt: r.c,
      lastSeenAt: r.l,
      expiresAt: r.e,
      userAgent: "",
      ip: "",
    };
  }
}
