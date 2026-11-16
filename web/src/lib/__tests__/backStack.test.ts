import { describe, expect, it } from "vitest";
import { isHome, sidewaysReplaces } from "../backStack";

describe("Back in the installed app (#96)", () => {
  it("treats the inbox, by path or by id, as home", () => {
    expect(isHome("/mail", "inbox1")).toBe(true);
    expect(isHome("/mail/", "inbox1")).toBe(true);
    expect(isHome("/mail/inbox1", "inbox1")).toBe(true);
    expect(isHome("/mail/inbox1/thread9", "inbox1")).toBe(false);
    expect(isHome("/mail/archive2", "inbox1")).toBe(false);
    expect(isHome("/calendar", "inbox1")).toBe(false);
  });

  it("keeps the inbox in the history when leaving it, and replaces every other page", () => {
    expect(sidewaysReplaces("/mail/inbox1", "inbox1", true)).toBe(false);
    expect(sidewaysReplaces("/mail/archive2", "inbox1", true)).toBe(true);
    expect(sidewaysReplaces("/calendar", "inbox1", true)).toBe(true);
    expect(sidewaysReplaces("/mail/archive2/thread9", "inbox1", true)).toBe(true);
  });

  it("leaves a browser tab's history alone", () => {
    expect(sidewaysReplaces("/mail/archive2", "inbox1", false)).toBe(false);
    expect(sidewaysReplaces("/calendar", "inbox1", false)).toBe(false);
  });
});
