import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CAP, client } from "@/jmap/client";
import type { JmapSession } from "@/jmap/types";
import { useSession } from "@/store/session";
import { useMail } from "@/store/mail";
import { composeBlocked, useCompose } from "@/store/compose";
import { delegatedAccounts, delegationOf, mayDestroy, mayWrite } from "@/lib/delegation";

/**
 * inbuxa AL-7: a locked account handed to the reader shows in place of their
 * own mail, and only mail follows it; the reader never loses their own
 * account, and a delegation taken away takes them back.
 */

const delegated = (access: string, sendAs = false) => ({
  name: "gone@example.com",
  isPersonal: false,
  isReadOnly: access === "read",
  accountCapabilities: {
    [CAP.mail]: {},
    [CAP.calendars]: {},
    [CAP.contacts]: {},
    [CAP.filenode]: {},
    "urn:inbuxa:jmap": { delegation: { locked: true, access, sendAs, until: null } },
  },
});

const sessionWith = (locked: Record<string, unknown> | null) =>
  ({
    capabilities: { [CAP.core]: { maxCallsInRequest: 16, maxObjectsInGet: 500 }, [CAP.mail]: {} },
    accounts: {
      own: {
        name: "me@example.com",
        isPersonal: true,
        accountCapabilities: { [CAP.mail]: {}, [CAP.calendars]: {}, [CAP.contacts]: {}, [CAP.filenode]: {} },
      },
      shared: { name: "team@example.com", isPersonal: false, accountCapabilities: { [CAP.mail]: {} } },
      ...(locked ? { locked } : {}),
    },
    primaryAccounts: { [CAP.mail]: "own", [CAP.calendars]: "own", [CAP.contacts]: "own", [CAP.filenode]: "own" },
    state: "s",
  }) as unknown as JmapSession;

let nextSession: JmapSession;

beforeEach(() => {
  nextSession = sessionWith(delegated("read"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/auth/session")) {
        return { ok: true, status: 200, json: async () => nextSession } as Response;
      }
      const { methodCalls } = JSON.parse((init?.body as string) ?? "{}") as { methodCalls: [string, Record<string, unknown>, string][] };
      const methodResponses = methodCalls.map(([name, args, id]) => [name, { accountId: args.accountId, state: "1", list: [], notFound: [] }, id]);
      return { ok: true, status: 200, json: async () => ({ methodResponses, sessionState: "s" }) } as Response;
    }),
  );
  const session = sessionWith(delegated("read"));
  client.session = session;
  useSession.setState({ status: "authenticated", session, accountId: "own", viewing: null, delegationEnded: null });
  useCompose.setState({ drafts: [] });
});

afterEach(() => {
  useSession.setState({ viewing: null });
  vi.unstubAllGlobals();
});

describe("delegation", () => {
  it("is read only from the session's mark, never from a shared account's capabilities", () => {
    const session = sessionWith(delegated("organize", true));
    expect(delegationOf(session, "locked")).toEqual({ locked: true, kind: "lock", access: "organize", sendAs: true, until: null });
    expect(delegationOf(session, "shared")).toBeNull();
    expect(delegationOf(session, "own")).toBeNull();
    expect(delegatedAccounts(session).map((a) => a.id)).toEqual(["locked"]);
  });

  it("never lets a read delegate send, whatever the server says", () => {
    const session = sessionWith(delegated("read", true));
    expect(delegationOf(session, "locked")?.sendAs).toBe(false);
  });

  it("says what each level may do", () => {
    const read = delegationOf(sessionWith(delegated("read")), "locked");
    const organize = delegationOf(sessionWith(delegated("organize")), "locked");
    expect(mayWrite(read)).toBe(false);
    expect(mayWrite(organize)).toBe(true);
    expect(mayDestroy(organize)).toBe(false);
    expect(mayWrite(null) && mayDestroy(null)).toBe(true);
  });
});

describe("viewing a locked account", () => {
  it("moves only the mail store; the session's own account stays", () => {
    useSession.getState().view("locked");
    expect(useMail.getState().accountId).toBe("locked");
    expect(useSession.getState().accountId).toBe("own");
    expect(useSession.getState().ownAccountFor(CAP.mail)).toBe("own");
    useSession.getState().view(null);
    expect(useMail.getState().accountId).toBe("own");
  });

  it("brings the whole account: calendar, contacts and files, never the reader's settings", () => {
    const s = () => useSession.getState();
    expect(s().viewAccountFor(CAP.calendars)).toBe("own");
    s().view("locked");
    for (const cap of [CAP.calendars, CAP.contacts, CAP.filenode]) {
      expect(s().viewAccountFor(cap)).toBe("locked");
    }
    // Settings live in the reader's own Files, whatever is in view
    expect(s().ownAccountFor(CAP.filenode)).toBe("own");
    s().view(null);
    expect(s().viewAccountFor(CAP.contacts)).toBe("own");
  });

  it("refuses an account that isn't delegated", () => {
    useSession.getState().view("shared");
    expect(useSession.getState().viewing).toBeNull();
    expect(useMail.getState().accountId).toBe("own");
  });

  it("goes back to the reader's own mail when the delegation ends", async () => {
    useSession.getState().view("locked");
    nextSession = sessionWith(null);
    await useSession.getState().refresh();
    expect(useSession.getState().viewing).toBeNull();
    expect(useSession.getState().delegationEnded).toBe("gone@example.com");
    expect(useMail.getState().accountId).toBe("own");
  });

  it("blocks writing mail where the delegate can't send", () => {
    expect(composeBlocked()).toBeNull();
    useSession.getState().view("locked");
    expect(composeBlocked()).toMatch(/gone@example.com/);
    expect(useCompose.getState().open()).toBe("");
    expect(useCompose.getState().drafts).toHaveLength(0);
  });

  it("lets a send-as delegate write", () => {
    const session = sessionWith(delegated("full", true));
    client.session = session;
    useSession.setState({ session });
    useSession.getState().view("locked");
    expect(composeBlocked()).toBeNull();
  });
});
