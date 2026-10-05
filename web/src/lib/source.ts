/**
 * Where to point someone who wants this instance's source.
 *
 * The AGPL asks whoever runs a modified version to offer *that* version's
 * source. The server says where its own lives, via SOURCE_URL; this is only the
 * fallback for when it has not been asked yet, or has nothing to say.
 *
 * ihasmail-inbuxa: INBUXA runs a modified ihasmail, so the offer is INBUXA's
 * fork and not the project it came from.
 */
export const DEFAULT_SOURCE_URL = "https://git.coffeylabs.org/inbuxa/inbuxa-webmail";
