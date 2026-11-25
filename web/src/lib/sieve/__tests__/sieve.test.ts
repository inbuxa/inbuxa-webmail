import { describe, expect, it } from "vitest";
import { needsAdministrator, newRule, reorderRules, rulesToSieve, sieveToRules, SORTING_ACTIONS, testToSieve, sieveString, upsertRule, type SieveRule } from "../sieve";

describe("sieve codec", () => {
  it("escapes strings", () => {
    expect(sieveString('a "quoted" \\ value')).toBe('"a \\"quoted\\" \\\\ value"');
  });
  it("generates tests", () => {
    expect(testToSieve({ type: "header", header: "subject", op: "contains", value: "hi" })).toBe('header :contains "subject" "hi"');
    expect(testToSieve({ type: "header", header: "x-foo", op: "notexists", value: "" })).toBe('not exists "x-foo"');
    expect(testToSieve({ type: "address", header: "from", part: "domain", op: "is", value: "example.com" })).toBe('address :domain :is "from" "example.com"');
    expect(testToSieve({ type: "size", op: "over", value: 2048 })).toBe("size :over 2048");
  });
  it("round-trips rules through a script", () => {
    const rules = [
      newRule({ id: "r1", name: "Newsletters", tests: [{ type: "header", header: "list-id", op: "exists", value: "" }], actions: [{ type: "fileinto", mailbox: "Newsletters" }, { type: "markread" }, { type: "stop" }] }),
      newRule({ id: "r2", name: "Big", enabled: false, join: "anyof", tests: [{ type: "size", op: "over", value: 5_000_000 }], actions: [{ type: "addflag", flag: "big" }] }),
    ];
    const script = rulesToSieve(rules);
    expect(script).toContain('require ["fileinto", "imap4flags"];');
    expect(script).toContain('if exists "list-id"');
    expect(script).toContain('fileinto "Newsletters";');
    expect(script).toContain('addflag "\\\\Seen";');
    expect(script).toContain("# (disabled) Big");
    expect(sieveToRules(script)).toEqual(rules);
  });
  it("keeps an edited rule in its place and appends a new one", () => {
    const rules = ["r1", "r2", "r3"].map((id) => newRule({ id, name: id }));
    const renamed = { ...rules[1]!, name: "Renamed" };
    expect(upsertRule(rules, renamed).map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
    expect(upsertRule(rules, renamed)[1]!.name).toBe("Renamed");
    expect(upsertRule(rules, newRule({ id: "r4" })).map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(rules.map((r) => r.name)).toEqual(["r1", "r2", "r3"]);
  });
  it("reports hand-written scripts as raw", () => {
    expect(sieveToRules('require ["fileinto"];\nif true { keep; }')).toBeNull();
    expect(sieveToRules("")).toEqual([]);
  });
});

describe("reordering rules", () => {
  const ids = (rs: SieveRule[]) => rs.map((r) => r.id);
  const list = ["a", "b", "c", "d"].map((id) => newRule({ id }));

  it("drops a rule above or below the card it was dropped on", () => {
    expect(ids(reorderRules(list, "a", "c", false))).toEqual(["b", "a", "c", "d"]);
    expect(ids(reorderRules(list, "a", "c", true))).toEqual(["b", "c", "a", "d"]);
    expect(ids(reorderRules(list, "d", "a", false))).toEqual(["d", "a", "b", "c"]);
    expect(ids(reorderRules(list, "b", "d", true))).toEqual(["a", "c", "d", "b"]);
  });
  it("leaves the list alone when the drop goes nowhere", () => {
    expect(reorderRules(list, "a", "a", true)).toBe(list);
    expect(reorderRules(list, "a", "zz", true)).toBe(list);
    expect(reorderRules(list, "zz", "a", true)).toBe(list);
    expect(ids(list)).toEqual(["a", "b", "c", "d"]);
  });
});

/**
 * #155: on a shared mailbox a member who isn't an administrator may only save
 * rules that sort. A rule an administrator saved there, one that forwards or
 * rejects, is shown read-only -- and because saving rewrites the whole script
 * from the rules, it has to come back out byte for byte when the others change.
 */
describe("rules only an administrator may change on a shared mailbox", () => {
  const forward: SieveRule = {
    id: "radmin",
    name: "Escalate to on-call",
    enabled: true,
    join: "anyof",
    tests: [{ type: "header", header: "subject", op: "contains", value: "outage" }],
    actions: [{ type: "redirect", address: "oncall@example.com", copy: true }, { type: "stop" }],
  };
  const bounce: SieveRule = { ...newRule({ id: "rreject", name: "Refuse spam" }), actions: [{ type: "reject", reason: "No thanks" }] };
  const sort = newRule({ id: "rsort", name: "Invoices", actions: [{ type: "fileinto", mailbox: "Invoices" }, { type: "markread" }] });

  it("counts forwarding and rejecting, and nothing that only sorts", () => {
    expect(needsAdministrator(forward)).toBe(true);
    expect(needsAdministrator(bounce)).toBe(true);
    expect(needsAdministrator(sort)).toBe(false);
    for (const type of ["discard", "stop", "flag", "keep"] as const) {
      expect(needsAdministrator(newRule({ actions: [{ type }] }))).toBe(false);
    }
  });

  it("counts an action it doesn't know, so a newer client's rule is left alone", () => {
    const future = { ...sort, actions: [{ type: "vacation", days: 7 }] } as unknown as SieveRule;
    expect(needsAdministrator(future)).toBe(true);
    expect(SORTING_ACTIONS.has("redirect")).toBe(false);
  });

  it("writes an administrator's rule back unchanged when the others are edited", () => {
    const script = rulesToSieve([sort, forward, bounce]);
    const blockOf = (text: string, id: string) => {
      const lines = text.split("\n");
      const at = lines.findIndex((l) => l.startsWith("# rule:") && l.includes(`"id":"${id}"`));
      const end = lines.indexOf("", at);
      return lines.slice(at, end).join("\n");
    };

    // What a member does: edit their own rule, add one, reorder around the others.
    const parsed = sieveToRules(script)!;
    const edited = parsed.map((r) => (r.id === "rsort" ? { ...r, name: "Invoices (paid)" } : r));
    const next = rulesToSieve([...reorderRules(edited, "rsort", "rreject", true), newRule({ id: "rnew", name: "Flag the boss" })]);

    expect(blockOf(next, "radmin")).toBe(blockOf(script, "radmin"));
    expect(blockOf(next, "rreject")).toBe(blockOf(script, "rreject"));
    expect(blockOf(next, "radmin")).toContain('redirect :copy "oncall@example.com";');
    // The extensions those rules need stay required.
    expect(next).toMatch(/^require \[.*"copy".*"reject".*\];$/m);
    expect(sieveToRules(next)!.find((r) => r.id === "radmin")).toEqual(forward);
  });
});
