import { create } from "zustand";
import { CAP, client, JmapMethodError, setErrorMessage } from "@/jmap/client";
import type { GetResponse, Id, JmapSession, SetError, SetResponse, SieveScript } from "@/jmap/types";
import { rulesToSieve, scriptDamage, sieveToRules, type SieveRule } from "@/lib/sieve/sieve";
import { actsAsAdministrator, permissionSet } from "@/lib/admin/adminAccess";
import { delegationOf } from "@/lib/delegation";
import type { SharedMailAccount } from "@/lib/sharedMail";
import { t } from "@/lib/i18n";
import { useSession } from "./session";

export const IHASMAIL_SCRIPT = "ihasmail";

/**
 * Whose filters the page edits, and on what terms.
 *
 * The reader's own, unless a shared mailbox is in view (MA-S): its mail is
 * sorted by its own script, so that is the one to edit. Rules written into the
 * reader's own script for a shared address never ran on its mail, and filed
 * into the reader's Inbox when they named its folders. A locked account handed
 * to the reader (AL-7) keeps the reader's own filters, as before.
 *
 * Only a member with full access may manage a shared mailbox's filters, and
 * only an administrator may make them forward, reject or answer mail. The
 * server enforces both; this only decides what the page offers.
 */
export interface FiltersTarget {
  accountId: Id | null;
  /** The shared mailbox, or null for the reader's own filters. */
  shared: { name: string } | null;
  /** Known without asking: the reader's access to the shared mailbox isn't full. */
  forbidden: boolean;
  /** Only sorting actions may be saved: a shared mailbox, and the reader isn't an administrator. */
  sortOnly: boolean;
}

export function filtersTarget(session: JmapSession | null, viewing: Id | null, sharedMail: readonly SharedMailAccount[], own: Id | null): FiltersTarget {
  const shared = viewing ? sharedMail.find((a) => a.id === viewing) : undefined;
  if (!shared) return { accountId: own, shared: null, forbidden: false, sortOnly: false };
  // An installation with administration off sends no permissions, so nobody
  // counts as an administrator here; the server still lets one save anything.
  const perms = permissionSet(session?.ihasmail?.administration === false ? [] : session?.ihasmail?.permissions);
  const admin = actsAsAdministrator(perms);
  const delegation = delegationOf(session, shared.id);
  return {
    accountId: shared.id,
    shared: { name: shared.name },
    forbidden: !admin && delegation !== null && delegation.access !== "full",
    sortOnly: !admin,
  };
}

const isForbidden = (err: unknown): boolean => err instanceof JmapMethodError && err.type === "forbidden";

/**
 * Why a save was refused. The server's own words when it gave some: on a
 * shared mailbox they say what only an administrator may save, which is the
 * whole answer. A bare `forbidden` there means the access isn't full.
 */
export function refusal(err: SetError, shared: boolean): string {
  if (shared && err.type === "forbidden" && !err.description) return t("You need full access to this mailbox to change its filters.");
  return setErrorMessage(err);
}

interface SieveState extends FiltersTarget {
  available: boolean;
  scripts: SieveScript[];
  /** Content of each script by id. */
  contents: Record<Id, string>;
  loading: boolean;
  error: string | null;
  init(): Promise<void>;
  load(): Promise<void>;
  getContent(id: Id): Promise<string>;
  /** Rules derived from the "ihasmail" script (null = the active script is hand-written). */
  /** `loaded` distinguishes "this script is hand-written" from "we could not read it". */
  rules(): { script: SieveScript | null; rules: SieveRule[] | null; content: string; loaded: boolean; damage: string | null };
  saveRules(rules: SieveRule[]): Promise<void>;
  saveScript(id: Id | null, name: string, content: string, activate: boolean): Promise<Id>;
  activate(id: Id | null): Promise<void>;
  destroy(id: Id): Promise<void>;
  validate(content: string): Promise<string | null>;
  applyChanges(types: Set<string>): void;
}

export const useSieve = create<SieveState>((set, get) => ({
  accountId: null,
  shared: null,
  forbidden: false,
  sortOnly: false,
  available: false,
  scripts: [],
  contents: {},
  loading: false,
  error: null,

  async init() {
    const s = useSession.getState();
    const target = filtersTarget(s.session, s.viewing, s.sharedMail, s.accountFor(CAP.sieve));
    const available = Boolean(target.accountId && client.hasCapability(CAP.sieve));
    // Another account's scripts are not this one's: never show them, or save
    // over them, while the new account's are on their way.
    const moved = target.accountId !== get().accountId;
    set({ ...target, available, ...(moved ? { scripts: [], contents: {}, error: null, loading: false } : {}) });
    if (available && !target.forbidden) await get().load();
  },

  async load() {
    const accountId = get().accountId;
    // Already answered: init() asks again when the mailbox or the session changes.
    if (!accountId || get().forbidden) return;
    set({ loading: true });
    try {
      const res = await client.call<GetResponse<SieveScript>>("SieveScript/get", { accountId, ids: null });
      // The reader switched mailboxes while this was asking.
      if (get().accountId !== accountId) return;
      set({ scripts: res.list, loading: false, error: null, forbidden: false });
      // Preload contents.
      //
      // A fetch that fails must not be recorded as "". An empty script parses
      // to an empty rule list, which reads as "this script has no rules" and is
      // indistinguishable from "we could not read this script" -- and the next
      // save then writes the whole script out from that empty baseline,
      // destroying every rule in it. That is issue #76.
      //
      // Leaving the key absent instead means `rules()` reports the content as
      // unknown, and `saveRules` refuses rather than guessing.
      const fetched: Record<Id, string> = {};
      await Promise.all(
        res.list.map(async (s) => {
          try {
            fetched[s.id] = await client.fetchBlobText(accountId, s.blobId, "application/sieve");
          } catch {
            /* leave absent: unknown, not empty */
          }
        }),
      );
      // Merged, not replaced: saveScript caches the content it just wrote, and
      // a reload whose fetch failed must not throw that away.
      if (get().accountId !== accountId) return;
      set((st) => ({ contents: { ...st.contents, ...fetched } }));
    } catch (err) {
      if (get().accountId !== accountId) return;
      // A shared mailbox's filters, and the reader's access isn't full. That
      // is an answer, not a failure, and the page says it as one.
      if (get().shared && isForbidden(err)) set({ loading: false, forbidden: true, scripts: [], contents: {}, error: null });
      else set({ loading: false, error: (err as Error).message });
    }
  },

  async getContent(id) {
    const cached = get().contents[id];
    if (cached != null) return cached;
    const s = get().scripts.find((x) => x.id === id);
    if (!s) return "";
    const text = await client.fetchBlobText(get().accountId!, s.blobId, "application/sieve");
    set((st) => ({ contents: { ...st.contents, [id]: text } }));
    return text;
  },

  rules() {
    const { scripts, contents } = get();
    const script = scripts.find((s) => s.name === IHASMAIL_SCRIPT) ?? scripts.find((s) => s.isActive) ?? null;
    if (!script) return { script: null, rules: [], content: "", loaded: true, damage: null };
    const content = contents[script.id];
    // Not loaded, or the fetch failed. `null` means "cannot say", which every
    // caller already treats as "do not edit this script" -- as opposed to `[]`,
    // which means "this script genuinely has no rules" and invites a save that
    // would overwrite whatever is really in it.
    if (content === undefined) return { script, rules: null, content: "", loaded: false, damage: null };
    // Read, but not all of it. Showing the rules that did parse would be the
    // most dangerous thing available: a short list that looks complete, over a
    // script that is not. Say "cannot say" here too.
    const damage = scriptDamage(content);
    if (damage) return { script, rules: null, content, loaded: true, damage };
    return { script, rules: sieveToRules(content), content, loaded: true, damage: null };
  },

  async saveRules(rules) {
    const existing = get().scripts.find((s) => s.name === IHASMAIL_SCRIPT) ?? null;
    // The last line of defense. Writing rules replaces the whole script, so
    // doing it from a baseline we never managed to read deletes whatever was
    // there. Refusing is recoverable; overwriting is not.
    if (existing) {
      const content = get().contents[existing.id];
      if (content === undefined) {
        throw new Error("Your filter script could not be read, so saving would overwrite it. Reload and try again.");
      }
      // Read in full is a separate question from read at all, and the answer
      // that cost rules in #76 was "partly". A baseline missing its tail writes
      // out just as confidently as one missing entirely.
      const damage = scriptDamage(content);
      if (damage) {
        throw new Error(`Your filter script ${damage}, so saving would overwrite the rest of it. Reload and try again.`);
      }
    }
    await get().saveScript(existing?.id ?? null, IHASMAIL_SCRIPT, rulesToSieve(rules), true);
  },

  async saveScript(id, name, content, activate) {
    const accountId = get().accountId!;
    const args: Record<string, unknown> = { accountId };
    let res: SetResponse<SieveScript>;
    try {
      const up = await client.upload(accountId, new Blob([content], { type: "application/sieve" }), { type: "application/sieve" });
      if (id) args.update = { [id]: { name, blobId: up.blobId } };
      else args.create = { s: { name, blobId: up.blobId } };
      if (activate) args.onSuccessActivateScript = id ?? "#s";
      res = await client.call<SetResponse<SieveScript>>("SieveScript/set", args);
    } catch (err) {
      // Access taken away since the page opened: show the page that says so.
      if (get().shared && isForbidden(err)) {
        set({ forbidden: true });
        throw new Error(t("You need full access to this mailbox to change its filters."));
      }
      throw err;
    }
    const err = id ? res.notUpdated?.[id] : res.notCreated?.s;
    if (err) throw new Error(refusal(err, get().shared !== null));
    const newId = id ?? res.created!.s!.id;
    set((s) => ({ contents: { ...s.contents, [newId]: content } }));
    await get().load();
    return newId;
  },

  async activate(id) {
    const accountId = get().accountId!;
    const args: Record<string, unknown> = { accountId };
    if (id) args.onSuccessActivateScript = id;
    else args.onSuccessDeactivateScript = true;
    // A no-op set with activation hooks.
    await client.call<SetResponse>("SieveScript/set", args);
    await get().load();
  },

  async destroy(id) {
    const accountId = get().accountId!;
    const res = await client.call<SetResponse>("SieveScript/set", { accountId, destroy: [id] });
    const err = res.notDestroyed?.[id];
    if (err) throw new Error(setErrorMessage(err));
    await get().load();
  },

  async validate(content) {
    const accountId = get().accountId!;
    try {
      const up = await client.upload(accountId, new Blob([content], { type: "application/sieve" }), { type: "application/sieve" });
      const res = await client.call<{ error: { type: string; description?: string } | null }>("SieveScript/validate", { accountId, blobId: up.blobId });
      return res.error ? (res.error.description ?? res.error.type) : null;
    } catch (err) {
      return (err as Error).message;
    }
  },

  applyChanges(types) {
    if (types.has("SieveScript")) void get().load();
  },
}));
