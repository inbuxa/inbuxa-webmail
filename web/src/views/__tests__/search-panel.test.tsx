import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SearchBar } from "../SearchBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * The search bar stays on screen from page to page, so its advanced panel
 * has to close by itself: on a tap outside it, on Escape, and when the page
 * changes. On a phone its Cancel button could end up off screen (#94).
 */
describe("the advanced search panel", () => {
  let host: HTMLDivElement;
  let root: Root;
  let navigate: (to: string) => void;

  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const memory = memoryLocation({ path: "/mail" });
    navigate = memory.navigate;
    await act(async () => {
      root.render(
        <Router hook={memory.hook}>
          <SearchBar />
          <p className="elsewhere">page</p>
        </Router>,
      );
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[aria-label="Advanced search"]')!.click();
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const panel = () => host.querySelector(".search-panel");
  const press = async (target: EventTarget, type: string, init: Record<string, unknown> = {}) => {
    const ev = type === "keydown" ? new KeyboardEvent(type, { bubbles: true, ...init }) : new MouseEvent(type, { bubbles: true });
    await act(async () => target.dispatchEvent(ev));
  };

  it("stays open while it is being filled in", async () => {
    expect(panel()).not.toBeNull();
    await press(panel()!.querySelector("input")!, "mousedown");
    expect(panel()).not.toBeNull();
  });

  it("closes on a click outside it", async () => {
    await press(host.querySelector(".elsewhere")!, "mousedown");
    expect(panel()).toBeNull();
  });

  it("closes on Escape", async () => {
    await press(document, "keydown", { key: "Escape" });
    expect(panel()).toBeNull();
  });

  it("closes when the page changes", async () => {
    await act(async () => navigate("/settings"));
    expect(panel()).toBeNull();
  });
});
