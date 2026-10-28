/**
 * What this build calls itself: the suite release it belongs to, `27.1-rc.1`,
 * bare on the release itself and followed by the pull request its commit
 * arrived through anywhere else, `27.1-rc.1+pr129`. A commit that did not come
 * through one carries its short SHA instead, `27.1-rc.1+g1fa6578`. Baked in by
 * Vite; see `scripts/version.mjs` for why the parts are what they are.
 */
export const APP_VERSION = __IHASMAIL_VERSION__;
