import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePullToRefresh } from "@/lib/input/touch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Pull-to-refresh and a row swipe start from the same place: a finger on a
 * row at the top of the list. A swipe that sank a few pixels as it went used
 * to start a pull too, so the list came down and refreshed under a row that
 * was being archived (forum t/232, post 49).
 */

function List({ onRefresh, onPull }: { onRefresh: () => void; onPull: (d: number, armed: boolean, live: boolean) => void }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  usePullToRefresh(el, onRefresh, { enabled: true, onPull });
  return <div ref={setEl} id="list" />;
}

/** A touch event jsdom can dispatch: it has no Touch constructor. */
function touch(type: string, x: number, y: number, ends = false) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "touches", { value: ends ? [] : [{ clientX: x, clientY: y }] });
  return e;
}

describe("usePullToRefresh", () => {
  let host: HTMLDivElement;
  let root: Root;
  let list: HTMLElement;
  const onRefresh = vi.fn();
  const onPull = vi.fn();

  beforeEach(() => {
    onRefresh.mockReset();
    onPull.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<List onRefresh={onRefresh} onPull={onPull} />));
    list = host.querySelector("#list")!;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  /** Drag from (0, 0) through `path`, then let go. */
  const drag = async (path: [number, number][]) => {
    list.dispatchEvent(touch("touchstart", 0, 0));
    const moves = path.map(([x, y]) => {
      const e = touch("touchmove", x, y);
      list.dispatchEvent(e);
      return e;
    });
    await act(async () => {
      list.dispatchEvent(touch("touchend", 0, 0, true));
    });
    return moves;
  };

  it("refreshes on a straight pull down", async () => {
    await drag([[0, 20], [0, 80], [0, 200]]);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("leaves a sideways swipe that drifts down to the row", async () => {
    // Clearly sideways when it locks (40 across, 6 down), then sinks well past
    // what would have armed a pull from a standing start.
    await drag([[40, 6], [120, 60], [200, 220]]);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onPull.mock.calls.every(([d]) => d === 0)).toBe(true);
  });

  it("doesn't move the list before it can tell which way the drag goes", async () => {
    await drag([[3, 8]]);
    expect(onPull).not.toHaveBeenCalled();
  });

  it("still takes a pull that wobbles sideways once it has locked", async () => {
    await drag([[2, 30], [60, 120], [80, 220]]);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("keeps the browser's overscroll out of an undecided drag down", async () => {
    const [e] = await drag([[1, 10]]);
    expect(e!.defaultPrevented).toBe(true);
  });
});
