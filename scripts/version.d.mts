/** Types for `version.mjs`, which is plain JS so the Dockerfile and shell can run it directly. */
export const UNVERSIONED: string;
export function readRelease(): string;
export function formatVersion(commit: { release: string; tagged?: boolean; subject?: string; sha: string }): string;
export function versionFromGit(release?: string): string | null;
export function resolveVersion(): string;
export function resolveRevision(): string | null;
