/**
 * ihasmail-inbuxa: `/.well-known/source`, what this webmail runs and where its
 * source is, in the form https://coffeylabs.org/specs/well-known-source/
 * gives it.
 *
 * It names SOURCE_URL as the repository and the commit the build was made
 * from (`resolveRevision` in scripts/version.mjs). A build that doesn't know
 * its commit says nothing and the address is a 404, since a repository without
 * a revision doesn't name the build. So does a checkout with uncommitted
 * changes: no public revision holds them.
 */

/** A full commit id: 40 hex digits (SHA-1) or 64 (SHA-256). */
export function isCommitId(revision: string | null | undefined): revision is string {
  return typeof revision === "string" && /^([0-9a-f]{40}|[0-9a-f]{64})$/i.test(revision);
}

/** The document for a build, or null when it can't name its commit. */
export function sourceDocument(build: { version: string; repository: string; revision: string | null }): string | null {
  if (!isCommitId(build.revision)) return null;
  return JSON.stringify({
    version: 1,
    software: [
      {
        name: "inbuxa Webmail",
        version: build.version,
        license: "AGPL-3.0-or-later",
        repository: build.repository,
        revision: build.revision,
      },
    ],
  });
}
