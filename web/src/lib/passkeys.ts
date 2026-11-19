import { ApiError, client, INBUXA_CAP, JmapMethodError } from "@/jmap/client";
import type { Id, JmapSession } from "@/jmap/types";
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
 * What listing the account's passkeys found (#119): the passkeys; `none`
 * when the server has no passkeys (not inbuxa, or older than the feature),
 * so the section stays hidden; `forbidden` when the server has them but
 * won't let this account use them; `failed` for anything else, with the
 * reason, so the reader can try again.
 */
export type PasskeyListing =
  | { kind: "list"; rows: Passkey[] }
  | { kind: "none" }
  | { kind: "forbidden" }
  | { kind: "failed"; message: string };

/** Errors that mean the server doesn't have passkeys at all. */
const NO_PASSKEYS = new Set(["unknownMethod", "unknownCapability", "urn:ietf:params:jmap:error:unknownCapability"]);

/** The account's passkeys, newest first, or why there are none to show. */
export async function listPasskeys(accountId: string): Promise<PasskeyListing> {
  try {
    const res = await client.call<{ list?: Record<string, unknown>[] }>(
      "inbuxa:Passkey/get",
      { accountId, ids: null, properties: PROPERTIES },
      [INBUXA_CAP],
    );
    const rows = (res.list ?? []).map(parse).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    return { kind: "list", rows };
  } catch (err) {
    if (err instanceof JmapMethodError) {
      if (NO_PASSKEYS.has(err.type)) return { kind: "none" };
      if (err.type === "forbidden") return { kind: "forbidden" };
    }
    if (err instanceof ApiError && NO_PASSKEYS.has(err.code)) return { kind: "none" };
    return { kind: "failed", message: (err as Error)?.message || t("Couldn't load your passkeys.") };
  }
}

/**
 * What the server says up front about adding a passkey to this account
 * (passkeys PK-19): `allowed` false when a switch turns passkeys off for it,
 * `max` the most it may have. Both undefined from a server that doesn't say,
 * which then refuses the add itself.
 */
export function passkeyPolicy(
  session: JmapSession | null,
  accountId: Id | null,
): { allowed?: boolean; max?: number } {
  if (!session || !accountId) return {};
  const cap = session.accounts[accountId]?.accountCapabilities?.[INBUXA_CAP] as
    | { passkeysAllowed?: unknown; maxPasskeys?: unknown }
    | undefined;
  return {
    allowed: typeof cap?.passkeysAllowed === "boolean" ? cap.passkeysAllowed : undefined,
    max: typeof cap?.maxPasskeys === "number" ? cap.maxPasskeys : undefined,
  };
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
