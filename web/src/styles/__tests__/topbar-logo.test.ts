import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Read off disk: `?raw` comes back empty for a stylesheet under the test runner.
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../app.css"), "utf8");

/*
 * #124: a wide custom logo in the top bar was cut off on a phone, the search
 * field painting over the rest. jsdom does no layout, so this pins the rule;
 * the result was checked in Chromium at 320, 375 and 440px.
 */
describe("top bar custom logo on a phone", () => {
  const phone = css.slice(css.indexOf("@media (max-width: 768px) {"));
  const rule = phone.slice(phone.indexOf(".topbar .brand img.server-logo {"));

  it("has a phone rule for the server logo", () => {
    expect(phone.indexOf(".topbar .brand img.server-logo {")).toBeGreaterThan(-1);
  });

  it("lets the logo shrink, capped by the screen, kept to the left", () => {
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toMatch(/min-width:\s*0/);
    expect(body).toMatch(/max-width:\s*\d+vw/);
    expect(body).toMatch(/object-position:\s*left/);
  });

  it("still scales the logo whole rather than cropping it", () => {
    expect(css).toMatch(/\.topbar \.brand img \{[^}]*object-fit:\s*contain/);
  });
});
