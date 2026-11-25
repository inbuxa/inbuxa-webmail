import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FiltersSettings } from "../FiltersSettings";
import { RuleDialog } from "../RuleDialog";
import { ConfirmHost } from "@/ui/dialog";
import { useSieve } from "@/store/sieve";
import { useSession } from "@/store/session";
import { newRule, rulesToSieve, type SieveRule } from "@/lib/sieve/sieve";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * #155: Settings › Filters with a shared mailbox in view. It says whose filters
 * they are, explains a refusal instead of failing, and keeps a member who isn't
 * an administrator to rules that sort.
 */

const sorting = newRule({ id: "r1", name: "Invoices", actions: [{ type: "fileinto", mailbox: "Invoices" }] });
const forwarding: SieveRule = { ...newRule({ id: "r2", name: "Escalate" }), actions: [{ type: "redirect", address: "oncall@example.com" }] };

describe("Filters on a shared mailbox", () => {
  let host: HTMLDivElement;
  let root: Root;

  const text = () => document.body.textContent ?? "";
  const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(label));
  const card = (name: string) => Array.from(document.querySelectorAll(".rule-card")).find((c) => c.textContent?.includes(name))!;

  const state = (over: Partial<ReturnType<typeof useSieve.getState>>) =>
    useSieve.setState({
      accountId: "ops", shared: { name: "ops@example.com" }, forbidden: false, sortOnly: true,
      available: true, loading: false, error: null,
      scripts: [{ id: "s1", name: "ihasmail", blobId: "b1", isActive: true }],
      contents: { s1: rulesToSieve([sorting, forwarding]) },
      ...over,
    });
  const render = (el: React.ReactNode) => act(() => root.render(<>{el}<ConfirmHost /></>));

  beforeEach(() => {
    useSession.setState({ sharedMail: [{ id: "ops", name: "ops@example.com" }] });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useSession.setState({ sharedMail: [] });
  });

  it("says whose filters these are", () => {
    state({});
    render(<FiltersSettings />);
    expect(document.querySelector("h1")?.textContent).toBe("Filters for ops@example.com");
    // The hint is for the reader's own page, not this one.
    expect(text()).not.toContain("only apply to mail delivered to you");
  });

  it("explains a refusal, and offers nothing that would fail", () => {
    state({ forbidden: true, scripts: [], contents: {} });
    render(<FiltersSettings />);
    expect(text()).toContain("You need full access to this mailbox to change its filters.");
    expect(button("New rule")).toBeUndefined();
    expect(document.querySelector(".view-switch")).toBeNull();
  });

  it("shows an administrator's forwarding rule read-only", () => {
    state({});
    render(<FiltersSettings />);
    const locked = card("Escalate");
    expect(locked.textContent).toContain("Saved by an administrator; only an administrator can change it");
    expect(locked.querySelector(".switch")?.hasAttribute("disabled")).toBe(true);
    expect((locked.querySelector('[aria-label="Delete rule"]') as HTMLButtonElement).disabled).toBe(true);
    const open = card("Invoices");
    expect(open.textContent).not.toContain("Saved by an administrator");
    expect((open.querySelector('[aria-label="Delete rule"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it("leaves an administrator's rule editable for an administrator", () => {
    state({ sortOnly: false });
    render(<FiltersSettings />);
    expect(card("Escalate").textContent).not.toContain("Saved by an administrator");
  });

  it("offers a member only actions that sort", () => {
    state({});
    render(<RuleDialog rule={sorting} onClose={() => undefined} onSave={() => undefined} />);
    const offered = Array.from(document.querySelectorAll<HTMLOptionElement>(".rule-row.actions select option")).map((o) => o.value);
    expect(offered).toEqual(expect.arrayContaining(["fileinto", "markread", "flag", "discard", "stop"]));
    expect(offered).not.toContain("redirect");
    expect(offered).not.toContain("reject");
  });

  it("offers forwarding again on the reader's own filters", () => {
    state({ shared: null, sortOnly: false, accountId: "me" });
    render(<RuleDialog rule={sorting} onClose={() => undefined} onSave={() => undefined} />);
    const offered = Array.from(document.querySelectorAll<HTMLOptionElement>(".rule-row.actions select option")).map((o) => o.value);
    expect(offered).toContain("redirect");
    expect(offered).toContain("reject");
  });
});

describe("the reader's own Filters page", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    useSieve.setState({
      accountId: "me", shared: null, forbidden: false, sortOnly: false, available: true, loading: false, error: null,
      scripts: [{ id: "s1", name: "ihasmail", blobId: "b1", isActive: true }], contents: { s1: rulesToSieve([sorting]) },
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useSession.setState({ sharedMail: [] });
  });

  const hint = "Rules here only apply to mail delivered to you. To sort a shared mailbox's mail, switch to it first.";

  it("says where a shared mailbox's rules go, when there is one", () => {
    useSession.setState({ sharedMail: [{ id: "ops", name: "ops@example.com" }] });
    act(() => root.render(<FiltersSettings />));
    expect(document.querySelector("h1")?.textContent).toBe("Filters & rules");
    expect(document.body.textContent).toContain(hint);
  });

  it("says nothing about it to someone with none", () => {
    act(() => root.render(<FiltersSettings />));
    expect(document.body.textContent).not.toContain(hint);
  });
});
