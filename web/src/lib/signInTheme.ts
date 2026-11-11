/**
 * The light or dark look on screen, for the mail server's sign-in page to
 * match (inbuxa-server #375). `applyTheme` has already resolved "follow the
 * system" into one of the two, so this is what the reader is looking at.
 */
export function signInTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
