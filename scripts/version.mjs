/**
 * Work out this build's version: `27.1-rc.1`, or `27.1-rc.1+pr129` between
 * releases.
 *
 *   27.1-rc.1  the release this commit belongs to, from the VERSION file
 *   +pr129     the pull request it arrived through, for a commit that is not
 *              itself that release
 *
 * The webmail is numbered with the rest of the INBUXA suite: 27.1 is a series,
 * 27.1.3 a patch of it, 27.1-rc.1 a release candidate. VERSION says which one
 * main is working towards, and changes only when a release is cut. The commit
 * tagged `inbuxa-v<VERSION>` *is* that release and reports it bare; every
 * other commit reports it with where the commit came from after a `+`, so a
 * build from main between two releases never passes itself off as the
 * release. SemVer ignores everything after the `+` when comparing, which is
 * the right reading: provenance, not rank.
 *
 * A commit that did not arrive through a pull request carries its short SHA
 * instead -- `27.1-rc.1+g1fa6578`.
 *
 * Until 27.1 the version was the commit's date (`2026.8.30+pr129`). Those
 * builds sort *above* 27.1 to anything that compares numerically, which is
 * said in the release notes: a pinned install switches by hand, once.
 *
 * `package.json` does not carry the version -- npm wants the field, so it
 * stays at `0.0.0`, which is what a build with no git to ask reports and is
 * meant to look wrong.
 *
 * `.dockerignore` excludes `.git`, so an image build cannot run any of this.
 * It takes the answer through `--build-arg IHASMAIL_VERSION=...` instead, and
 * whoever builds is responsible for computing it -- see deploy.example.sh.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** What a build with nothing to go on reports, and it should look wrong. */
export const UNVERSIONED = "0.0.0";

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** The suite's release form: YY.M, YY.M.N or YY.M-rc.N. */
const RELEASE = /^[1-9][0-9]\.([1-9]|1[0-2])(\.[1-9][0-9]*|-rc\.[1-9][0-9]*)?$/;

/**
 * A pull request's merge commit. Gitea writes
 * `Merge pull request 'Title' (#76) from branch into main`; GitHub, which
 * merged the older history, `Merge pull request #129 from owner/branch`. The
 * title may hold a `(#n)` of its own, so the number is the last one before
 * ` from `.
 */
const PR_SUBJECT = /^Merge pull request (?:#(\d+)\b|'.*' \(#(\d+)\) from )/;

/** The release named in VERSION; anything else there is a mistake to stop on. */
export function readRelease() {
  const release = readFileSync(join(root, "VERSION"), "utf8").trim();
  if (!RELEASE.test(release)) throw new Error(`VERSION says "${release}", which is not YY.M, YY.M.N or YY.M-rc.N`);
  return release;
}

/**
 * The version for a commit, from the things about it that decide one. Pure,
 * so the rules can be exercised without a repository staged to produce them:
 * `{ release: "27.1-rc.1", subject: "Merge pull request 'x' (#129) from y
 * into main", sha: "1fa6578" }` gives `27.1-rc.1+pr129`, and the same with
 * `tagged: true` gives `27.1-rc.1`.
 */
export function formatVersion({ release, tagged = false, subject = "", sha }) {
  if (tagged) return release;
  const m = PR_SUBJECT.exec(subject);
  const pr = m?.[1] ?? m?.[2];
  return pr ? `${release}+pr${pr}` : `${release}+g${sha}`;
}

/**
 * The version for the commit checked out here, or null when there is no git to
 * ask -- an unpacked tarball, or the Docker build context.
 */
export function versionFromGit(release) {
  let head;
  try {
    head = git("rev-parse", "--short", "HEAD");
  } catch {
    return null;
  }
  // Read only once git has answered: the running image has neither git nor
  // VERSION, and is told its version instead.
  release ??= readRelease();
  let subject = "";
  let tags = [];
  try {
    subject = git("show", "-s", "--format=%s", "HEAD");
    tags = git("tag", "--points-at", "HEAD").split("\n");
  } catch {
    /* nothing more to read; fall through to the SHA */
  }
  return formatVersion({ release, tagged: tags.includes(`inbuxa-v${release}`), subject, sha: head });
}

/** Whatever the environment was told, else git, else an answer that looks wrong. */
export function resolveVersion() {
  const fromEnv = process.env.IHASMAIL_VERSION?.trim();
  if (fromEnv) return fromEnv;
  return versionFromGit() ?? UNVERSIONED;
}

// `node scripts/version.mjs` prints it, for shell scripts and CI.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(resolveVersion() + "\n");
}
