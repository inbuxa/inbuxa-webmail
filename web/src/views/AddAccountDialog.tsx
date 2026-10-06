import { useEffect, useState, type FormEvent } from "react";
import { Dialog } from "@/ui/dialog";
import { apiFetch } from "@/jmap/client";
import { withBase } from "@/lib/basePath";
import { clearSignedInData, isDeviceTrusted } from "@/lib/storage";
import { t } from "@/lib/i18n";

/**
 * inbuxa MA-B: sign a second account in beside the one in front.
 *
 * With sign-in on the mail server's own page and one mail server, there is
 * nothing to ask here: the browser goes straight to that page, which asks for
 * the account. With several servers the address comes first, to pick one; with
 * the password form, so does the password. Either way the account joins the
 * others and comes to the front, and the app reloads into it.
 *
 * It is remembered on this device exactly as the first one was (MA-7).
 */
export function AddAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<"oauth" | "oauth-address" | "password" | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remember = isDeviceTrusted();

  useEffect(() => {
    if (!open) return;
    setError(null);
    let live = true;
    fetch(withBase("/api/config"))
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!live) return;
        const oauth = c?.signIn === "oauth";
        const next = oauth ? (c?.signInDirect === true ? "oauth" : "oauth-address") : "password";
        setMode(next);
        // Nothing to ask: off to the mail server's page
        if (next === "oauth") goToServer("");
      })
      .catch(() => live && setMode("password"));
    return () => {
      live = false;
    };
    // goToServer only reads `remember`, fixed for the dialog's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function goToServer(address: string) {
    setBusy(true);
    // What is cached belongs to the account in front, which won't be
    clearSignedInData();
    const params = new URLSearchParams({ add: "1", ...(address ? { username: address } : {}), ...(remember ? { remember: "1" } : {}) });
    window.location.assign(withBase(`/api/auth/oauth/start?${params}`));
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    if (mode === "oauth-address") return goToServer(username.trim());
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password, remember, add: true }),
      });
      clearSignedInData();
      window.location.reload();
    } catch (err) {
      setError((err as Error).message || t("That account couldn't be added."));
      setBusy(false);
    }
  };

  if (mode === "oauth") return null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("Add an account")}
      size="sm"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {t("Cancel")}
          </button>
          <button className="btn btn-primary" form="add-account" type="submit" disabled={busy || !username.trim() || (mode === "password" && !password)}>
            {busy ? t("Working…") : t("Add account")}
          </button>
        </>
      }
    >
      <form id="add-account" onSubmit={(e) => void submit(e)}>
        <p className="hint">{t("Both accounts stay signed in here; switch between them from this menu.")}</p>
        <div className="field">
          <label htmlFor="add-account-user">{t("Email address")}</label>
          <input id="add-account-user" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </div>
        {mode === "password" && (
          <div className="field">
            <label htmlFor="add-account-pw">{t("Password")}</label>
            <input id="add-account-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </form>
    </Dialog>
  );
}
