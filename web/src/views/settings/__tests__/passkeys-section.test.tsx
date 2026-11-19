import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PasskeyListing } from "@/lib/passkeys";

const listPasskeys = vi.fn<(accountId: string) => Promise<PasskeyListing>>();
vi.mock("@/lib/passkeys", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/passkeys")>()),
  listPasskeys: (accountId: string) => listPasskeys(accountId),
}));

import { Passkeys } from "../SecuritySettings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * #119: the section used to show "Loading…" and then vanish whenever the
 * list didn't load, so a reader whose account wasn't allowed passkeys saw
 * the feature appear and disappear with no reason. It hides itself only on
 * a server without passkeys now, and otherwise says why.
 */
describe("Passkeys section", () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async () => {
    await act(async () => {
      root.render(<Passkeys accountId="acc" />);
    });
  };

  beforeEach(() => {
    listPasskeys.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("stays hidden on a server without passkeys", async () => {
    listPasskeys.mockResolvedValue({ kind: "none" });
    await render();
    expect(host.textContent).toBe("");
  });

  it("says when the account isn't allowed passkeys, and offers no add", async () => {
    listPasskeys.mockResolvedValue({ kind: "forbidden" });
    await render();
    expect(host.textContent).toContain("Passkeys");
    expect(host.textContent).toContain("aren't available for this account");
    expect(host.querySelector("form")).toBeNull();
  });

  it("shows a failure with its reason, and tries again", async () => {
    listPasskeys.mockResolvedValueOnce({ kind: "failed", message: "Bad Gateway" });
    await render();
    expect(host.textContent).toContain("Couldn't load your passkeys.");
    expect(host.textContent).toContain("Bad Gateway");
    listPasskeys.mockResolvedValueOnce({ kind: "list", rows: [] });
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Retry")!;
    await act(async () => retry.click());
    expect(listPasskeys).toHaveBeenCalledTimes(2);
    expect(host.querySelector("form")).not.toBeNull();
  });

  it("lists the passkeys and offers the add", async () => {
    listPasskeys.mockResolvedValue({
      kind: "list",
      rows: [{ id: "a", name: "Phone", state: "active", usable: true, backedUp: false, createdAt: null, lastUsedAt: null }],
    });
    await render();
    expect(host.textContent).toContain("Phone");
    expect(host.querySelector("form")).not.toBeNull();
  });
});
