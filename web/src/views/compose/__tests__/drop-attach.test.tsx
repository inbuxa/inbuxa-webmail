import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RichEditor } from "../RichEditor";
import { droppedAttachments } from "../Composer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

/*
 * A file dropped on the editor used to be attached twice: once by the editor,
 * and again by the composer around it, which sees the same drop bubble up
 * (#95). The editor sits in a stand-in for the composer here, whose drop
 * handler adds what droppedAttachments gives it, as the composer's does.
 */
describe("dropping files on the composer", () => {
  let host: HTMLDivElement;
  let root: Root;
  let onFiles: ReturnType<typeof vi.fn<(files: File[]) => void>>;
  let attached: File[][];

  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    onFiles = vi.fn<(files: File[]) => void>();
    attached = [];
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn(() => true);
    await act(async () => {
      root.render(
        <div
          className="composer"
          onDrop={(e) => {
            const files = droppedAttachments(e);
            e.preventDefault();
            if (files.length) attached.push(files);
          }}
        >
          <div className="composer-head" />
          <RichEditor html="<p>hello</p>" onChange={() => {}} onFiles={onFiles} showToolbar={false} />
        </div>,
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const drop = async (target: Element, files: File[]) => {
    const ev = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "dataTransfer", { value: { files, types: ["Files"] } });
    await act(async () => target.dispatchEvent(ev));
  };
  const editor = () => host.querySelector('[contenteditable="true"]')!;
  const pdf = () => new File(["%PDF"], "report.pdf", { type: "application/pdf" });

  it("attaches a file dropped on the editor once", async () => {
    await drop(editor(), [pdf()]);
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(attached).toEqual([]);
  });

  it("attaches a file dropped elsewhere in the composer", async () => {
    const file = pdf();
    await drop(host.querySelector(".composer-head")!, [file]);
    expect(onFiles).not.toHaveBeenCalled();
    expect(attached).toEqual([[file]]);
  });
});
