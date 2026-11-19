import { beforeEach, describe, expect, it, vi } from "vitest";

const call = vi.fn();
vi.mock("@/jmap/client", () => ({ client: { call: (...a: unknown[]) => call(...a) }, INBUXA_CAP: "urn:inbuxa:jmap" }));

import { addErrorMessage, listPasskeys, passkeyPolicy, removePasskey, renamePasskey, startPasskey } from "@/lib/passkeys";
import type { JmapSession } from "@/jmap/types";

describe("passkeys (#334)", () => {
  beforeEach(() => { call.mockReset(); });

  it("lists the account's passkeys, newest first", async () => {
    call.mockResolvedValue({
      list: [
        { id: "a", name: "Phone", state: "active", usable: true, backedUp: true, createdAt: "2026-11-01T10:00:00Z", lastUsedAt: null },
        { id: "b", name: "Key", state: "active", usable: false, backedUp: false, createdAt: "2026-11-10T10:00:00Z", lastUsedAt: "2026-11-11T10:00:00Z" },
      ],
    });
    const rows = await listPasskeys("acc");
    expect(call).toHaveBeenCalledWith("inbuxa:Passkey/get", expect.objectContaining({ accountId: "acc", ids: null }), ["urn:inbuxa:jmap"]);
    expect(rows?.map((r) => r.id)).toEqual(["b", "a"]);
    expect(rows?.[0]).toMatchObject({ usable: false, lastUsedAt: "2026-11-11T10:00:00Z" });
  });

  it("hides the section on a server without passkeys", async () => {
    call.mockImplementation(async () => { throw new Error("unknownMethod"); });
    expect(await listPasskeys("acc")).toBeNull();
  });

  it("returns the registration page of a new passkey", async () => {
    call.mockResolvedValue({ created: { k: { id: "p", registrationUrl: "https://mail.example.org/passkey/register?t=x" } } });
    await expect(startPasskey("acc", "Phone")).resolves.toBe("https://mail.example.org/passkey/register?t=x");
    expect(call.mock.calls[0]![1]).toEqual({ accountId: "acc", create: { k: { accountId: "acc", name: "Phone" } } });
  });

  it("says why adding was refused", async () => {
    call.mockResolvedValue({ notCreated: { k: { type: "overQuota" } } });
    await expect(startPasskey("acc", "Phone")).rejects.toThrow(/as many passkeys/);
    expect(addErrorMessage({ type: "forbidden" })).toMatch(/turned off/);
    expect(addErrorMessage({ type: "invalidProperties", description: "Too long" })).toBe("Too long");
  });

  it("renames and removes, and reports a refusal", async () => {
    call.mockResolvedValue({});
    await renamePasskey("acc", "p", "Laptop");
    expect(call.mock.calls[0]![1]).toEqual({ accountId: "acc", update: { p: { name: "Laptop" } } });
    await removePasskey("acc", "p");
    expect(call.mock.calls[1]![1]).toEqual({ accountId: "acc", destroy: ["p"] });
    call.mockResolvedValue({ notDestroyed: { p: { type: "notFound" } } });
    await expect(removePasskey("acc", "p")).rejects.toThrow();
  });

  it("reads up front whether adding is allowed (PK-19)", () => {
    const session = (cap: Record<string, unknown>) =>
      ({ accounts: { acc: { accountCapabilities: { "urn:inbuxa:jmap": cap } } } }) as unknown as JmapSession;
    expect(passkeyPolicy(session({ passkeysAllowed: false, maxPasskeys: 10 }), "acc")).toEqual({ allowed: false, max: 10 });
    expect(passkeyPolicy(session({ passkeysAllowed: true, maxPasskeys: 3 }), "acc")).toEqual({ allowed: true, max: 3 });
    // an older server says nothing: the add is offered and refused there
    expect(passkeyPolicy(session({ logo: null }), "acc")).toEqual({ allowed: undefined, max: undefined });
    expect(passkeyPolicy(null, "acc")).toEqual({});
  });
});
