import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerLogo } from "@/lib/serverLogo";

let logo: ServerLogo = { status: "default" };
vi.mock("@/lib/serverLogo", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/serverLogo")>()),
  useServerLogo: () => logo,
}));

import { LoginPage } from "../Login";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * #122: under an administrator's own logo the inbuxa wordmark sat directly
 * beneath it, two logos crowding the card. With a custom logo the wordmark
 * goes and the footer credits inbuxa as "Powered by inbuxa Webmail".
 */
describe("Sign-in page with a custom logo", () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async () => {
    await act(async () => {
      root.render(<LoginPage />);
    });
  };
  const heading = () => host.querySelector("h1")!;
  const foot = () => host.querySelector(".foot")!;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("shows the wordmark and the plain footer without one", async () => {
    logo = { status: "default" };
    await render();
    expect(heading().classList.contains("sr-only")).toBe(false);
    expect(heading().querySelector("svg, img")).not.toBeNull();
    expect(foot().textContent).toContain("inbuxa Webmail v");
    expect(foot().textContent).not.toContain("Powered by");
    expect([...foot().querySelectorAll("a")].map((a) => a.textContent)).toEqual(["inbuxa.org", "AGPL-3.0 source"]);
  });

  it("hides the wordmark under a custom logo, keeping the heading for screen readers", async () => {
    logo = { status: "custom", url: "/api/logo" };
    await render();
    expect(host.querySelector("img.server-logo")).not.toBeNull();
    expect(heading().classList.contains("sr-only")).toBe(true);
    expect(heading().textContent).toBe("inbuxa");
  });

  it("credits inbuxa in the footer under a custom logo, and keeps the source link", async () => {
    logo = { status: "custom", url: "/api/logo" };
    await render();
    expect(foot().textContent).toMatch(/^Powered by inbuxa Webmail v\S+AGPL-3\.0 source$/);
    const links = [...foot().querySelectorAll("a")];
    expect(links.map((a) => a.textContent)).toEqual(["inbuxa Webmail", "AGPL-3.0 source"]);
    expect(links[0]!.getAttribute("href")).toBe("https://inbuxa.org");
  });

  it("holds the wordmark unseen while the logo is still being asked for", async () => {
    logo = { status: "loading" };
    await render();
    expect(heading().style.visibility).toBe("hidden");
  });
});
