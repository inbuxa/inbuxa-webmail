import { describe, expect, it } from "vitest";
import { homeIsBehind, inboxIdOf, isHome, sidewaysReplaces, stepsBackHome, withBehind } from "../backStack";

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

describe("going to the inbox steps back to it (#142)", () => {
  const start = {};
  // Inbox -> folder pushes, recording that the inbox is behind
  const folder = withBehind({}, start, false, true, null);
  // folder -> another folder replaces, keeping what is behind
  const other = withBehind({}, folder, true, false, null);

  it("records the inbox behind a page pushed from it, and keeps it through replaces", () => {
    expect(homeIsBehind(folder, null)).toBe(true);
    expect(homeIsBehind(other, null)).toBe(true);
    expect(homeIsBehind(withBehind({}, folder, false, false, null), null)).toBe(false);
  });

  it("steps back instead of replacing the folder with a second inbox", () => {
    expect(stepsBackHome("/mail/archive2", "/mail/inbox1", "inbox1", true, true, other, null)).toBe(true);
    expect(stepsBackHome("/calendar", "/mail", "inbox1", true, true, other, null)).toBe(true);
  });

  it("doesn't step back from the inbox, to anywhere else, or without the inbox behind", () => {
    expect(stepsBackHome("/mail/inbox1", "/mail", "inbox1", true, true, other, null)).toBe(false);
    expect(stepsBackHome("/mail/archive2", "/mail/sent3", "inbox1", true, true, other, null)).toBe(false);
    expect(stepsBackHome("/mail/archive2", "/mail/inbox1", "inbox1", true, true, {}, null)).toBe(false);
    expect(stepsBackHome("/mail/archive2", "/mail/inbox1", "inbox1", true, true, null, null)).toBe(false);
  });

  it("doesn't step back into another account's inbox", () => {
    // Your own inbox, then a group: the group's folder has your inbox behind it
    const groupFolder = withBehind({}, {}, false, true, null);
    expect(stepsBackHome("/mail/g-archive", "/mail/g-inbox", "g-inbox", true, true, groupFolder, "group")).toBe(false);
  });

  it("leaves a browser tab's history alone", () => {
    expect(stepsBackHome("/mail/archive2", "/mail/inbox1", "inbox1", false, true, other, null)).toBe(false);
    expect(stepsBackHome("/mail/archive2", "/mail/inbox1", "inbox1", true, false, other, null)).toBe(false);
  });

  it("finds the inbox among the folders", () => {
    expect(inboxIdOf({ a: { id: "a", role: "sent" }, b: { id: "b", role: "inbox" } })).toBe("b");
    expect(inboxIdOf({})).toBeUndefined();
  });
});
