import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatVersion, readRelease, resolveVersion, UNVERSIONED, versionFromGit } from "../../scripts/version.mjs";

/**
 * The version is this build's public identity: it names the image, and it is
 * what About and /api/health report. It is the suite's release number from
 * VERSION, bare on the tagged release and with the commit's provenance after
 * a `+` on anything else.
 */

const commit = { release: "27.1-rc.1", sha: "1fa6578" };

test("the tagged release reports VERSION exactly", () => {
  assert.equal(formatVersion({ ...commit, tagged: true, subject: "Merge pull request 'x' (#129) from y into main" }), "27.1-rc.1");
});

test("a Gitea pull request merge is named by its number", () => {
  // Gitea's subject, which the dated scheme never matched: every Gitea merge
  // went out as +g<sha>.
  assert.equal(
    formatVersion({ ...commit, subject: "Merge pull request 'Fetch List-Unsubscribe as URLs (#12 follow-up)' (#76) from fix/list-unsubscribe-as-urls into main" }),
    "27.1-rc.1+pr76",
  );
});

test("a GitHub pull request merge from the older history is named too", () => {
  assert.equal(formatVersion({ ...commit, subject: "Merge pull request #129 from Coffey-Labs/link-project-site-v2" }), "27.1-rc.1+pr129");
});

test("a commit that did not come through a pull request carries its SHA", () => {
  // Claiming the last PR would say it *is* that PR rather than something after it.
  assert.equal(formatVersion({ ...commit, subject: "Fix a thing directly on main" }), "27.1-rc.1+g1fa6578");
  assert.equal(formatVersion({ ...commit, subject: "Mention pull request #5 in passing" }), "27.1-rc.1+g1fa6578");
});

test("an untagged commit never reports bare, so it cannot pass for the release", () => {
  assert.match(formatVersion(commit), /\+/);
});

test("VERSION names a suite release and nothing else", () => {
  const release = readRelease();
  assert.equal(release, readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim());
  assert.match(release, /^[1-9][0-9]\.([1-9]|1[0-2])(\.[1-9][0-9]*|-rc\.[1-9][0-9]*)?$/);
});

test("an explicit IHASMAIL_VERSION wins, because the Docker build has no git", () => {
  const before = process.env.IHASMAIL_VERSION;
  process.env.IHASMAIL_VERSION = "27.1-rc.1+pr129";
  try {
    assert.equal(resolveVersion(), "27.1-rc.1+pr129");
  } finally {
    if (before === undefined) delete process.env.IHASMAIL_VERSION;
    else process.env.IHASMAIL_VERSION = before;
  }
});

test("a checkout with git resolves to a real version, and an unversioned build looks wrong", () => {
  const release = readRelease();
  assert.ok((versionFromGit() ?? "").startsWith(release));
  assert.match(versionFromGit("27.1") ?? "", /^27\.1(\+(pr\d+|g[0-9a-f]+))?$/);
  assert.equal(UNVERSIONED, "0.0.0");
});
