import { afterEach, describe, expect, it, vi } from "vitest";
import { domainOf, probeServerLogo, resetServerLogos, serverLogoUrl } from "@/lib/serverLogo";

/** An `Image` that loads, or fails, the way the browser would for `/api/logo`. */
function fakeImage(loads: boolean) {
  const sources: string[] = [];
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
      sources.push(value);
      queueMicrotask(() => (loads ? this.onload?.() : this.onerror?.()));
    }
  }
  vi.stubGlobal("Image", FakeImage);
  return sources;
}

describe("the server's logo (#101)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetServerLogos();
  });

  it("asks for the reader's domain, and for the dark-mode logo in the dark theme", () => {
    expect(serverLogoUrl("", "light")).toBe("/api/logo");
    expect(serverLogoUrl("example.org", "light")).toBe("/api/logo?domain=example.org");
    expect(serverLogoUrl("example.org", "dark")).toBe("/api/logo?domain=example.org&theme=dark");
    expect(serverLogoUrl("", "dark")).toBe("/api/logo?theme=dark");
  });

  it("takes the domain from the address", () => {
    expect(domainOf("Jane@Example.ORG")).toBe("example.org");
    expect(domainOf("jane")).toBe("");
    expect(domainOf(undefined)).toBe("");
  });

  it("probes each URL once, as an image", async () => {
    const sources = fakeImage(true);
    probeServerLogo("/api/logo?theme=dark");
    probeServerLogo("/api/logo?theme=dark");
    probeServerLogo("/api/logo");
    await Promise.resolve();
    expect(sources).toEqual(["/api/logo?theme=dark", "/api/logo"]);
  });
});
