import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useContacts } from "@/store/contacts";
import { useSession } from "@/store/session";
import { CAP, client, JmapMethodError } from "@/jmap/client";
import type { JmapSession } from "@/jmap/types";

/*
 * With directory queries off the server refuses Principal/query, but
 * Principal/get still answers for the accounts the reader already has to do
 * with. Those are what put a name on a share and find a sharer's free/busy.
 */

const alice = { id: "c", type: "individual", name: "Alice Tester" };
const carol = { id: "e", type: "individual", name: "Carol Sender" };
const forbidden = () => new JmapMethodError("Principal/query", { type: "forbidden" });

const session = {
  capabilities: { [CAP.core]: {}, [CAP.principals]: {} },
  accounts: { c: { name: "alice@example.com", isPersonal: true, accountCapabilities: { [CAP.principals]: {} } } },
  primaryAccounts: { [CAP.principals]: "c" },
  state: "s",
} as unknown as JmapSession;

beforeEach(() => {
  client.session = session;
  useSession.setState({ status: "authenticated", session, accountId: "c" });
  useContacts.setState({ accountId: "c", principals: [], principalsLoaded: false, directoryPrivate: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadPrincipals", () => {
  it("reads the whole directory when the server allows it", async () => {
    vi.spyOn(client, "chain").mockResolvedValue(new Map([["g", [{ list: [alice, carol] }]]]) as never);
    const call = vi.spyOn(client, "call");
    await useContacts.getState().loadPrincipals();
    const s = useContacts.getState();
    expect(s.principals).toEqual([alice, carol]);
    expect(s.directoryPrivate).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it("falls back to the accounts the reader knows when the query is refused", async () => {
    vi.spyOn(client, "chain").mockRejectedValue(forbidden());
    const call = vi.spyOn(client, "call").mockResolvedValue({ list: [alice, carol] } as never);
    await useContacts.getState().loadPrincipals();
    const s = useContacts.getState();
    expect(call).toHaveBeenCalledWith("Principal/get", expect.objectContaining({ ids: null }));
    expect(s.principals).toEqual([alice, carol]);
    expect(s.directoryPrivate).toBe(true);
    expect(s.principalsLoaded).toBe(true);
  });

  it("stays empty when the fallback is refused too", async () => {
    vi.spyOn(client, "chain").mockRejectedValue(forbidden());
    vi.spyOn(client, "call").mockRejectedValue(new JmapMethodError("Principal/get", { type: "forbidden" }));
    await useContacts.getState().loadPrincipals();
    const s = useContacts.getState();
    expect(s.principals).toEqual([]);
    expect(s.directoryPrivate).toBe(true);
    expect(s.principalsLoaded).toBe(true);
  });

  it("does not call a network failure a private directory", async () => {
    vi.spyOn(client, "chain").mockRejectedValue(new Error("offline"));
    const call = vi.spyOn(client, "call");
    await useContacts.getState().loadPrincipals();
    const s = useContacts.getState();
    expect(s.directoryPrivate).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });
});
