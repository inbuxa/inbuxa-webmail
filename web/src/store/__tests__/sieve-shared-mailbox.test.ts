import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAP, client, JmapMethodError } from "@/jmap/client";
import type { JmapSession } from "@/jmap/types";
import { useSession } from "@/store/session";
import { filtersTarget, refusal, useSieve } from "@/store/sieve";
import { newRule, rulesToSieve } from "@/lib/sieve/sieve";

/**
 * #155: a shared mailbox's mail is sorted by its own script, so with one in
 * view the Filters page edits that, on the terms the server sets (inbuxa-server
 * #643): full access to manage them at all, and an administrator to make them
 * forward, reject or answer mail.
 */

const INBUXA = "urn:inbuxa:jmap";
const shared = (access: "read" | "organize" | "full") => ({
  name: "ops@example.com",
  isPersonal: false,
  accountCapabilities: { [CAP.mail]: {}, [CAP.sieve]: {}, [INBUXA]: { delegation: { locked: true, kind: "sharedMailbox", access } } },
});
const session = (access: "read" | "organize" | "full", permissions: string[] = []): JmapSession =>
  ({
    capabilities: { [CAP.core]: {}, [CAP.mail]: {}, [CAP.sieve]: {} },
    accounts: {
      me: { name: "me@example.com", isPersonal: true, accountCapabilities: { [CAP.mail]: {}, [CAP.sieve]: {} } },
      ops: shared(access),
    },
    primaryAccounts: { [CAP.mail]: "me", [CAP.sieve]: "me" },
    ihasmail: { permissions },
  }) as unknown as JmapSession;
const OPS = [{ id: "ops", name: "ops@example.com" }];

const show = (s: JmapSession, viewing: string | null) => {
  client.session = s;
  useSession.setState({ session: s, accountId: "me", viewing, sharedMail: OPS });
};

beforeEach(() => {
  useSieve.setState({ accountId: null, shared: null, forbidden: false, sortOnly: false, available: false, scripts: [], contents: {}, loading: false, error: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  client.session = null;
});

describe("whose filters the page edits", () => {
  it("is the reader's own with no shared mailbox in view", () => {
    expect(filtersTarget(session("full"), null, OPS, "me")).toEqual({ accountId: "me", shared: null, forbidden: false, sortOnly: false });
  });

  it("is the shared mailbox's when it is in view, sorting only for a member", () => {
    expect(filtersTarget(session("full"), "ops", OPS, "me")).toEqual({ accountId: "ops", shared: { name: "ops@example.com" }, forbidden: false, sortOnly: true });
  });

  it("is refused without asking for Read and Organize members", () => {
    expect(filtersTarget(session("read"), "ops", OPS, "me").forbidden).toBe(true);
    expect(filtersTarget(session("organize"), "ops", OPS, "me").forbidden).toBe(true);
  });

  it("lets an administrator save anything, whatever their delegation says", () => {
    const t = filtersTarget(session("read", ["impersonate"]), "ops", OPS, "me");
    expect(t.forbidden).toBe(false);
    expect(t.sortOnly).toBe(false);
  });

  it("keeps the reader's own for an account that isn't shared mail", () => {
    // A locked account handed to the reader (AL-7) is not in sharedMail.
    expect(filtersTarget(session("full"), "locked", OPS, "me").accountId).toBe("me");
  });
});

describe("the sieve store on a shared mailbox", () => {
  it("loads the shared mailbox's scripts and drops the reader's own", async () => {
    useSieve.setState({ accountId: "me", scripts: [{ id: "mine", name: "ihasmail", blobId: "b0", isActive: true }], contents: { mine: "x" } });
    show(session("full"), "ops");
    const call = vi.spyOn(client, "call").mockResolvedValue({ list: [] } as never);
    await useSieve.getState().init();
    expect(call).toHaveBeenCalledWith("SieveScript/get", { accountId: "ops", ids: null });
    expect(useSieve.getState()).toMatchObject({ accountId: "ops", scripts: [], contents: {}, sortOnly: true, forbidden: false });
  });

  it("does not ask when the delegation already says no", async () => {
    show(session("organize"), "ops");
    const call = vi.spyOn(client, "call");
    await useSieve.getState().init();
    expect(call).not.toHaveBeenCalled();
    expect(useSieve.getState().forbidden).toBe(true);
  });

  it("reads the server's Forbidden as no full access, not as an error", async () => {
    show(session("full"), "ops");
    vi.spyOn(client, "call").mockRejectedValue(new JmapMethodError("SieveScript/get", { type: "forbidden" }));
    await useSieve.getState().init();
    expect(useSieve.getState().forbidden).toBe(true);
    expect(useSieve.getState().error).toBeNull();
  });

  it("keeps a Forbidden on the reader's own account an ordinary error", async () => {
    show(session("full"), null);
    vi.spyOn(client, "call").mockRejectedValue(new JmapMethodError("SieveScript/get", { type: "forbidden" }));
    await useSieve.getState().init();
    expect(useSieve.getState().forbidden).toBe(false);
    expect(useSieve.getState().error).toMatch(/forbidden/);
  });

  it("shows the server's words when it refuses a save", async () => {
    show(session("full"), "ops");
    const words = "Forwarding and automatic replies on a shared mailbox can only be saved by an administrator.";
    vi.spyOn(client, "call").mockResolvedValue({ list: [] } as never);
    await useSieve.getState().init();
    vi.spyOn(client, "upload").mockResolvedValue({ blobId: "up1" } as never);
    vi.spyOn(client, "call").mockResolvedValue({ notCreated: { s: { type: "forbidden", description: words } } } as never);
    await expect(useSieve.getState().saveRules([newRule()])).rejects.toThrow(words);
  });

  it("turns a Forbidden on save into the no-access page", async () => {
    show(session("full"), "ops");
    vi.spyOn(client, "call").mockResolvedValue({ list: [] } as never);
    await useSieve.getState().init();
    vi.spyOn(client, "upload").mockRejectedValue(new JmapMethodError("upload", { type: "forbidden" }));
    await expect(useSieve.getState().saveScript(null, "ihasmail", rulesToSieve([]), true)).rejects.toThrow(/full access/);
    expect(useSieve.getState().forbidden).toBe(true);
  });

  it("throws away an answer for a mailbox no longer in view", async () => {
    show(session("full"), "ops");
    let answer!: (v: unknown) => void;
    vi.spyOn(client, "call").mockImplementation(() => new Promise((r) => { answer = r; }) as never);
    const loading = useSieve.getState().init();
    useSieve.setState({ accountId: "me" });
    answer({ list: [{ id: "theirs", name: "ihasmail", blobId: "b", isActive: true }] });
    await loading;
    expect(useSieve.getState().scripts).toEqual([]);
  });
});

describe("refusal", () => {
  it("prefers the server's description", () => {
    expect(refusal({ type: "forbidden", description: "Only an administrator." }, true)).toBe("Only an administrator.");
  });
  it("explains a bare forbidden on a shared mailbox", () => {
    expect(refusal({ type: "forbidden" }, true)).toMatch(/full access/);
    expect(refusal({ type: "forbidden" }, false)).toBe("forbidden");
  });
});
