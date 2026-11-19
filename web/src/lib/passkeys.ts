import { client, INBUXA_CAP } from "@/jmap/client";
import { t } from "@/lib/i18n";

/**
 * An account's passkeys, `inbuxa:Passkey` (inbuxa-server passkeys spec,
 * PK-5 to PK-16). The browser part of registration runs on the mail server's
 * own page (`registrationUrl`), because a passkey is bound to the server's
 * name and this webmail runs on another one.
 */
export interface Passkey {
  id: string;
  name: string;
  /** `pending` until the registration page has finished, then `active`. */
  state: "pending" | "active";
  /** False once the server's name changed after the passkey was added (PK-4). */
  usable: boolean;
  /** The authenticator said the key is synced, e.g. in a password manager. */
  backedUp: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
}

/** Why adding a passkey failed, in words for the reader. */
export class PasskeyError extends Error {
  constructor(public readonly type: string, message: string) {
    super(message);
  }
}

interface SetError { type: string; description?: string }

const PROPERTIES = ["id", "name", "state", "usable", "backedUp", "createdAt", "lastUsedAt"];

function parse(raw: Record<string, unknown>): Passkey {
  return {
    id: String(raw.id),
    name: typeof raw.name === "string" ? raw.name : "",
    state: raw.state === "pending" ? "pending" : "active",
    usable: raw.usable === true,
    backedUp: raw.backedUp === true,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
    lastUsedAt: typeof raw.lastUsedAt === "string" ? raw.lastUsedAt : null,
  };
}

/**
 * The account's passkeys, newest first; null when the server has no passkeys
 * (not inbuxa, or older than the feature), so the section stays hidden.
 */
export async function listPasskeys(accountId: string): Promise<Passkey[] | null> {
  try {
    const res = await client.call<{ list?: Record<string, unknown>[] }>(
      "inbuxa:Passkey/get",
      { accountId, ids: null, properties: PROPERTIES },
      [INBUXA_CAP],
    );
    return (res.list ?? []).map(parse).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  } catch {
    return null;
  }
}

/** Words for a refused create (PK-5). */
export function addErrorMessage(err: SetError): string {
  switch (err.type) {
    case "forbidden":
      return t("Passkeys are turned off for this account.");
    case "overQuota":
      return t("This account has as many passkeys as it's allowed. Remove one to add another.");
    default:
      return err.description ?? t("Couldn't add the passkey.");
  }
}

/**
 * Starts registering a passkey: the server makes a pending record and
 * returns the page that finishes it. The link is given out once and works
 * for 10 minutes.
 */
export async function startPasskey(accountId: string, name: string): Promise<string> {
  const res = await client.call<{
    created?: Record<string, { id: string; registrationUrl?: string | null }> | null;
    notCreated?: Record<string, SetError> | null;
  }>("inbuxa:Passkey/set", { accountId, create: { k: { accountId, name } } }, [INBUXA_CAP]);
  const failed = res.notCreated?.k;
  if (failed) throw new PasskeyError(failed.type, addErrorMessage(failed));
  const url = res.created?.k?.registrationUrl;
  if (!url) throw new PasskeyError("serverFail", t("The server didn't return a page to add the passkey on."));
  return url;
}

export async function renamePasskey(accountId: string, id: string, name: string): Promise<void> {
  const res = await client.call<{ notUpdated?: Record<string, SetError> | null }>(
    "inbuxa:Passkey/set",
    { accountId, update: { [id]: { name } } },
    [INBUXA_CAP],
  );
  const failed = res.notUpdated?.[id];
  if (failed) throw new PasskeyError(failed.type, failed.description ?? t("Couldn't rename the passkey."));
}

/** Removes a passkey. The server then ends every session of the account (PK-15). */
export async function removePasskey(accountId: string, id: string): Promise<void> {
  const res = await client.call<{ notDestroyed?: Record<string, SetError> | null }>(
    "inbuxa:Passkey/set",
    { accountId, destroy: [id] },
    [INBUXA_CAP],
  );
  const failed = res.notDestroyed?.[id];
  if (failed) throw new PasskeyError(failed.type, failed.description ?? t("Couldn't remove the passkey."));
}
