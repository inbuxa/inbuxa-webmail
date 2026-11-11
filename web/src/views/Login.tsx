import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { useSession } from "@/store/session";
import { ApiError } from "@/jmap/client";
import { withBase } from "@/lib/basePath";
import { signInTheme } from "@/lib/signInTheme";
import { APP_VERSION } from "@/lib/version";
import { DEFAULT_SOURCE_URL } from "@/lib/source";
import { DEFAULT_APP_NAME, brandImage } from "@/lib/brand";
import { t } from "@/lib/i18n";
import { InbuxaWordmark } from "@/ui/InbuxaWordmark";

export function LoginPage() {
  const login = useSession((s) => s.login);
  // The AGPL's offer has to reach everyone who interacts with the app over the
  // network, and that includes whoever is looking at this form.
  const [sourceUrl, setSourceUrl] = useState(DEFAULT_SOURCE_URL);
  /*
   * What this instance calls itself.
   *
   * The name was in the `/api/config` answer all along and only `sourceUrl`
   * was taken out of it, so an instance with `APP_NAME` set still said
   * "ihasmail" on the one page a new user meets first -- the page where the
   * name matters most, and the one the rebranding guide had to tell people to
   * patch themselves.
   *
   * Defaults to ihasmail and stays there if the request fails, because a
   * sign-in form with no name on it would be worse than a wrong one.
   */
  const [appName, setAppName] = useState(DEFAULT_APP_NAME);
  /*
   * How this installation signs people in: on the mail server's own page
   * ("oauth"), or with the password form. Unknown until the config arrives,
   * and the password form if it never does.
   */
  const [signIn, setSignIn] = useState<"oauth" | "password" | null>(null);
  /* With "oauth" and one mail server, its page asks for the username: no address here. */
  const [direct, setDirect] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(withBase("/api/config"))
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!live || !c) return;
        if (c.sourceUrl) setSourceUrl(c.sourceUrl as string);
        if (typeof c.appName === "string" && c.appName.trim()) setAppName(c.appName.trim());
        setSignIn(c.signIn === "oauth" ? "oauth" : "password");
        setDirect(c.signIn === "oauth" && c.signInDirect === true);
      })
      .catch(() => { /* the default stands */ })
      .finally(() => { if (live) setSignIn((m) => m ?? "password"); });
    return () => { live = false; };
  }, []);
  const [username, setUsername] = useState(() => localStorage.getItem("ihasmail:lastUser") ?? "");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => takeSignInNotice());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (signIn === "oauth") {
      // Off to the mail server's page, which asks for the password there.
      if (!direct && !username.trim()) return;
      setBusy(true);
      if (trustDevice && !direct) localStorage.setItem("ihasmail:lastUser", username.trim());
      const params = new URLSearchParams({ ...(direct ? {} : { username: username.trim() }), ...(trustDevice ? { remember: "1" } : {}), theme: signInTheme() });
      window.location.assign(withBase(`/api/auth/oauth/start?${params}`));
      return;
    }
    if (!username || !password) return;
    setBusy(true);
    setError(null);
    try {
      // No two-factor code: the field is not on this form until the flow works
      // end to end, and the server treats an absent code as none given.
      await login(username.trim(), password, "", trustDevice);
      if (trustDevice) localStorage.setItem("ihasmail:lastUser", username.trim());
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "invalid_credentials") {
          setError(t("Invalid username or password."));
        } else if (err.code === "rate_limited") setError(t("Too many attempts. Please wait a few minutes and try again."));
        else setError(err.message || t("Could not sign in."));
      } else setError(t("Network error. Please check your connection."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="logo">
          <img src={brandImage(appName === DEFAULT_APP_NAME ? "/img/inbuxa-mark.png" : "/img/logo.png")} alt="" width={120} height={126} />
          {/* A product name, not a word: not translated, and not guessed at
              from the page it is on. INBUXA's is its wordmark. */}
          <h1 className="notranslate" translate="no">
            {appName === DEFAULT_APP_NAME ? <InbuxaWordmark height={34} /> : appName}
          </h1>
          <p className="tagline">{t("Fast, friendly webmail. Your mailbox, your way.")}</p>
        </div>
        {error && (
          <div className="error-box mb-16" role="alert">
            {error}
          </div>
        )}
        {!direct && (
        <div className="field">
          <label htmlFor="u">{t("Email or username")}</label>
          <input id="u" className="input" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={!username} required />
        </div>
        )}
        {signIn === "oauth" ? (
          <p className="hint" style={{ marginBottom: 12 }}>
            {direct
              ? t("You'll sign in on your mail server's own page.")
              : t("You'll enter your password on your mail server's sign-in page.")}
          </p>
        ) : (
        <div className="field">
          <label htmlFor="p">{t("Password")}</label>
          <div className="pw-wrap">
            <input id="p" className="input" type={showPw ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={Boolean(username)} required style={{ paddingRight: 40 }} />
            <button type="button" className="icon-btn" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? t("Hide password") : t("Show password")} tabIndex={-1}>
              {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>
        )}
        <label className="check" style={{ marginBottom: 4 }}>
          <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
          <span>{t("This is my own device")}</span>
        </label>
        <p className="hint" style={{ marginBottom: 12 }}>
          {trustDevice
            ? "Stay signed in, and keep settings and recent addresses on this computer."
            : "Signed out after 5 minutes of inactivity, and nothing is kept on this computer. Leave this unticked on a shared or public one."}
        </p>
        <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy || signIn === null}>
          {busy ? <span className="spinner" style={{ borderTopColor: "#fff" }} /> : <LogIn size={18} />}
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="foot">
          {/*
            The version sits directly above the source link on purpose: the
            AGPL's offer is for the source of *this* build, and naming the
            build is what makes that offer something a person can act on. It
            also means a bug report can name the build without anyone having
            to sign in to find it.

            One <p> with a break rather than two: .foot carries a 20px
            margin-top, which a second paragraph would repeat as a gap.
          */}
          {/* ihasmail-inbuxa: this build is INBUXA's webmail, and its site is INBUXA's. */}
          <span className="notranslate" translate="no">inbuxa webmail v{APP_VERSION}</span>
          <br />
          <a href="https://inbuxa.org" target="_blank" rel="noopener noreferrer" className="notranslate" translate="no">inbuxa.org</a>
          {" · "}
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{t("AGPL-3.0 source")}</a>
        </p>
      </form>
    </div>
  );
}

/*
 * Why the sign-in page is showing, when something sent it here: an error the
 * mail server's page came back with (`?signin_error=`), or a notice left by a
 * change that signed this session out. Read once, then removed, so a reload
 * doesn't repeat it.
 */
const SIGNIN_ERROR_LABELS: Record<string, string> = {
  state_mismatch: "This sign-in didn't start in this browser. Try again.",
  expired: "The sign-in took too long. Try again.",
  cancelled: "Sign-in was cancelled.",
  exchange_failed: "The mail server didn't accept the sign-in. Try again.",
  wrong_account: "That account is on a different mail server than the address you entered. Sign in with that address.",
  unsupported_server: "This mail server isn't supported.",
  unavailable: "Couldn't reach the mail server. Try again in a moment.",
  rate_limited: "Too many attempts. Please wait a few minutes and try again.",
  password_changed: "Your password was changed. Sign in with the new one.",
  signed_out: "Your sign-in ended. Sign in again.",
};

export const SIGNIN_NOTICE_KEY = "ihasmail:signinNotice";

function takeSignInNotice(): string | null {
  let code: string | null = null;
  try {
    code = sessionStorage.getItem(SIGNIN_NOTICE_KEY);
    sessionStorage.removeItem(SIGNIN_NOTICE_KEY);
  } catch { /* storage may be unavailable */ }
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("signin_error");
  if (fromUrl) {
    code = fromUrl;
    url.searchParams.delete("signin_error");
    window.history.replaceState(null, "", url.toString());
  }
  if (!code) return null;
  return t(SIGNIN_ERROR_LABELS[code] ?? "Could not sign in.");
}
