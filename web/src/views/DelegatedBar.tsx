import { Lock, Users } from "lucide-react";
import { useLocation } from "wouter";
import { useSession, useViewingDelegation, useViewingShared } from "@/store/session";
import { useCompose } from "@/store/compose";
import { backToOwnMail } from "@/lib/accountHistory";
import { t } from "@/lib/i18n";
import type { DelegationAccess } from "@/lib/delegation";

export function accessText(access: DelegationAccess): string {
  switch (access) {
    case "read":
      return t("Read only");
    case "organize":
      return t("Read and organize");
    case "full":
      return t("Full access");
  }
}

/**
 * inbuxa AL-7: while a locked account's mail is in view, a red bar across
 * the whole app says so, with the way back. Red, not the palette's accent: a
 * fixed color that reads the same in every palette and in dark mode, so it
 * can't be mistaken for part of a theme.
 */
export function DelegatedBar() {
  const viewing = useSession((s) => s.viewing);
  const name = useSession((s) => (s.viewing ? s.session?.accounts[s.viewing]?.name : undefined));
  const delegation = useViewingDelegation();
  const shared = useViewingShared();
  const [, navigate] = useLocation();
  // Steps back past this account's pages rather than adding one (#143)
  const back = () => backToOwnMail(navigate, useCompose.getState().drafts.length > 0);
  // MA-A: a shared or group mailbox in view says whose it is, with the same way back
  if (viewing && shared) {
    return (
      <div className="delegated-bar shared" role="status">
        <Users size={15} aria-hidden />
        <span className="grow truncate">
          {t("Shared mailbox:")} <strong className="notranslate" translate="no">{shared.name}</strong>
          {/* MA-S: one an administrator assigned says at what level */}
          {delegation ? ` · ${accessText(delegation.access)}` : ""}
          {delegation?.sendAs ? ` · ${t("You can send as this account")}` : ""}
        </span>
        <button type="button" onClick={back}>
          {t("Back to my mail")}
        </button>
      </div>
    );
  }
  if (!viewing || !delegation) return null;
  return (
    <div className="delegated-bar" role="status">
      <Lock size={15} aria-hidden />
      <span className="grow truncate">
        {t("Locked account:")} <strong className="notranslate" translate="no">{name}</strong>
        {" · "}
        {accessText(delegation.access)}
        {delegation.sendAs ? ` · ${t("You can send as this account")}` : ""}
      </span>
      <button type="button" onClick={back}>
        {t("Back to my mail")}
      </button>
    </div>
  );
}
