import { beforeEach, describe, expect, it, vi } from "vitest";
import { CAP } from "@/jmap/client";
import type { JmapSession } from "@/jmap/types";
import { useSession } from "@/store/session";
import { backToOwnMail, followHistory, onHistoryMove, positionsIn, startPositions, stepsBackToOwn, viewingIn, withPositions, withViewing } from "@/lib/accountHistory";

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

describe("Back to my mail (#143)", () => {
  // Your own inbox, then a switch to the group, a folder there, a message
  const start = startPositions(null, null);
  const switched = withPositions(withViewing(undefined, "group"), start, false, "group");
  const folder = withPositions(withViewing(undefined, "group"), switched, true, "group");
  const message = withPositions(withViewing(undefined, "group"), folder, false, "group");

  it("counts the pages since your own mail was last shown", () => {
    expect(positionsIn(start)).toEqual({ pos: 0, own: 0 });
    expect(stepsBackToOwn(switched)).toBe(1);
    expect(stepsBackToOwn(folder)).toBe(1);
    expect(stepsBackToOwn(message)).toBe(2);
  });

  it("starts again from a page that shows your own mail", () => {
    const own = withPositions(withViewing(undefined, null), message, false, null);
    expect(positionsIn(own)).toEqual({ pos: 3, own: 3 });
    expect(stepsBackToOwn(own)).toBe(0);
  });

  it("keeps a page's position through a reload, now on your own mail", () => {
    expect(positionsIn(startPositions(message, null))).toEqual({ pos: 2, own: 2 });
  });

  it("doesn't guess after a page with no positions", () => {
    expect(positionsIn(withPositions({}, {}, false, "group"))).toBeNull();
    expect(stepsBackToOwn(withPositions({}, null, false, "group"))).toBe(0);
    for (const bad of [{ inbuxaPos: 1, inbuxaOwnPos: 2 }, { inbuxaPos: 1.5, inbuxaOwnPos: 0 }, { inbuxaPos: "2", inbuxaOwnPos: 0 }]) {
      expect(positionsIn(bad)).toBeNull();
    }
  });

  it("steps back past the group's pages instead of adding a page", () => {
    useSession.getState().view("group");
    window.history.replaceState(message, "");
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
    const navigate = vi.fn();
    backToOwnMail(navigate, false);
    expect(go).toHaveBeenCalledWith(-2);
    expect(navigate).not.toHaveBeenCalled();
    go.mockRestore();
  });

  it("switches and replaces the page while a message is being written, or with no positions", () => {
    for (const [state, writing] of [[message, true], [{}, false]] as const) {
      useSession.getState().view("group");
      window.history.replaceState(state, "");
      const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
      const navigate = vi.fn();
      backToOwnMail(navigate, writing);
      expect(go).not.toHaveBeenCalled();
      expect(useSession.getState().viewing).toBeNull();
      expect(navigate).toHaveBeenCalledWith("/mail", { replace: true });
      go.mockRestore();
    }
  });
});
