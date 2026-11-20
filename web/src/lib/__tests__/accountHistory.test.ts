import { beforeEach, describe, expect, it } from "vitest";
import { CAP } from "@/jmap/client";
import type { JmapSession } from "@/jmap/types";
import { useSession } from "@/store/session";
import { followHistory, onHistoryMove, viewingIn, withViewing } from "@/lib/accountHistory";

/**
 * #133: after switching to a group's mail, Back closed the installed app.
 * The account shown isn't in the address, so the history had nothing that
 * could bring your own mail back. Each page now carries the account it was
 * showing, and Back onto it switches back.
 */

const session = {
  capabilities: { [CAP.core]: { maxCallsInRequest: 16, maxObjectsInGet: 500 }, [CAP.mail]: {} },
  accounts: {
    own: { name: "me@example.com", isPersonal: true, accountCapabilities: { [CAP.mail]: {} } },
    group: { name: "support@example.com", isPersonal: false, accountCapabilities: { [CAP.mail]: {} } },
    sales: { name: "sales@example.com", isPersonal: false, accountCapabilities: { [CAP.mail]: {} } },
  },
  primaryAccounts: { [CAP.mail]: "own" },
  state: "s",
} as unknown as JmapSession;

beforeEach(() => {
  useSession.setState({
    status: "authenticated",
    session,
    accountId: "own",
    viewing: null,
    sharedMail: [
      { id: "group", name: "support@example.com" },
      { id: "sales", name: "sales@example.com" },
    ],
  });
});

describe("the account a page was showing", () => {
  it("is written into the page's state and read back", () => {
    expect(viewingIn(withViewing(undefined, "group"))).toBe("group");
    expect(viewingIn(withViewing(null, null))).toBeNull();
  });

  it("keeps whatever else the page's state held", () => {
    expect(withViewing({ other: 1 }, "group")).toEqual({ other: 1, inbuxaViewing: "group" });
  });

  it("is your own account on a page with no mark, such as the one the app opened on", () => {
    for (const state of [null, undefined, "x", 3, {}, { inbuxaViewing: "" }, { inbuxaViewing: 7 }]) {
      expect(viewingIn(state)).toBeNull();
    }
  });
});

describe("Back and Forward across an account switch", () => {
  it("brings your own mail back from a group", () => {
    useSession.getState().view("group");
    expect(followHistory(withViewing(null, null), false)).toBe("switched");
    expect(useSession.getState().viewing).toBeNull();
  });

  it("goes forward into the group again", () => {
    expect(followHistory(withViewing(null, "group"), false)).toBe("switched");
    expect(useSession.getState().viewing).toBe("group");
  });

  it("goes from one group back to the one before it", () => {
    useSession.getState().view("sales");
    expect(followHistory(withViewing(null, "group"), false)).toBe("switched");
    expect(useSession.getState().viewing).toBe("group");
  });

  it("does nothing between pages of the same account", () => {
    useSession.getState().view("group");
    expect(followHistory(withViewing(null, "group"), false)).toBe("same");
    expect(followHistory(withViewing(null, "group"), true)).toBe("same");
    expect(useSession.getState().viewing).toBe("group");
  });

  it("shows your own mail for a page whose account is gone", () => {
    useSession.getState().view("group");
    useSession.setState({ sharedMail: [{ id: "sales", name: "sales@example.com" }] });
    useSession.getState().view("sales");
    expect(followHistory(withViewing(null, "group"), false)).toBe("switched");
    expect(useSession.getState().viewing).toBeNull();
  });

  it("keeps the account while a message is being written in it", () => {
    useSession.getState().view("group");
    expect(followHistory(withViewing(null, null), true)).toBe("kept");
    expect(useSession.getState().viewing).toBe("group");
  });
});

describe("the order on Back", () => {
  it("switches the account before the router hears of the move", () => {
    // The router adds its listener when it first renders, after this module loaded
    const order: string[] = [];
    const router = () => order.push("router");
    window.addEventListener("popstate", router);
    const undo = onHistoryMove(() => order.push("account"));
    window.dispatchEvent(new PopStateEvent("popstate", { state: withViewing(null, "group") }));
    undo();
    window.removeEventListener("popstate", router);
    expect(order).toEqual(["account", "router"]);
  });

  it("stops handling once the shell lets go", () => {
    const seen: string[] = [];
    onHistoryMove(() => seen.push("x"))();
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(seen).toEqual([]);
  });
});
