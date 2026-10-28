import { useEffect, useState } from "react";
import { useSession } from "@/store/session";
import { useAppName } from "@/lib/brand";
import { apiFetch, client } from "@/jmap/client";
import { APP_VERSION } from "@/lib/version";
import { DEFAULT_SOURCE_URL } from "@/lib/source";
import { t, tNode } from "@/lib/i18n";
import { InbuxaWordmark } from "@/ui/InbuxaWordmark";
import { brandImage } from "@/lib/brand";

/** ihasmail-inbuxa: which webmail node answered and which mail node it talks to (server/src/nodes.ts). */
interface Nodes {
  webmail: string;
  mailServer: { host: string; address: string | null; name: string | null };
}

function mailNodeLabel(m: Nodes["mailServer"]): string {
  if (!m.address) return t("{host} does not resolve", { host: m.host });
  // The node's hostname; the bare address only when it has no PTR record.
  return m.name ?? m.address;
}

export function AboutSettings() {
  const appName = useAppName();
  const session = useSession((s) => s.session);
  // Fetched on every visit, not cached with the session: when troubleshooting,
  // the question is which nodes are in use now.
  const [nodes, setNodes] = useState<Nodes | null | "error">(null);
  useEffect(() => {
    apiFetch<Nodes>("/api/about/nodes").then(setNodes).catch(() => setNodes("error"));
  }, []);
  const nodeCell = (v: (n: Nodes) => string) =>
    nodes === null ? t("Loading…") : nodes === "error" ? t("unavailable") : <span className="mono notranslate" translate="no">{v(nodes)}</span>;
  const caps = Object.keys(session?.capabilities ?? {});
  // Only a session that may administer is told where the console is.
  const adminUrl = session?.ihasmail?.server?.adminUrl ?? null;
  // A deployment running modified code should offer its own source, not ours.
  const sourceUrl = session?.ihasmail?.sourceUrl ?? DEFAULT_SOURCE_URL;
  return (
    <div>
      {/* ihasmail-inbuxa: INBUXA's webmail, built on ihasmail. The version and
          source are this build's, the AGPL's offer; ihasmail keeps its credit.
          The name comes from APP_NAME now, so a renamed deployment is named
          here too. */}
      <h1>{t("About {app}", { app: appName })}</h1>
      {/* inbuxa is the suite, not only this webmail: the product name here is
          inbuxa's own, not APP_NAME. */}
      <p className="lead">{tNode("{inbuxa} is a complete mail suite: a mail server, the console that administers it, and this webmail, each its own program, installed together and free under the AGPL.", { inbuxa: <strong className="brand-inbuxa notranslate" translate="no">inbuxa</strong> })}</p>
      <div className="row" style={{ gap: 16, alignItems: "center", marginBottom: 16 }}>
        <img src={brandImage("/img/inbuxa-mark.png")} alt="" width={80} />
        <div>
          <InbuxaWordmark height={26} />
          {/* A product name and a version string: neither is a word to translate. */}
          <div style={{ fontWeight: 700 }} className="notranslate" translate="no">{appName} webmail v{APP_VERSION}</div>
          <div className="hint">{tNode("Built on {project}", { project: <a href="https://ihasmail.org" target="_blank" rel="noopener noreferrer" className="notranslate" translate="no">ihasmail</a> })}</div>
          <div className="hint">{tNode("AGPL-3.0-or-later · {source}", { source: <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="notranslate" translate="no">{sourceUrl.replace(/^https?:\/\//, "")}</a> })}</div>
        </div>
      </div>
      <h2>{t("The suite")}</h2>
      <table className="sessions-table">
        <tbody>
          <tr><td>{t("Mail server")}</td><td className="notranslate" translate="no">inbuxa</td></tr>
          {adminUrl && (
            <tr><td>{t("Administration console")}</td><td><a href={adminUrl} target="_blank" rel="noopener noreferrer" className="notranslate" translate="no">{adminUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a></td></tr>
          )}
          <tr><td>{t("Webmail")}</td><td className="notranslate" translate="no">v{APP_VERSION}</td></tr>
          <tr><td>{t("Website")}</td><td><a href="https://inbuxa.org" target="_blank" rel="noopener noreferrer" className="notranslate" translate="no">inbuxa.org</a></td></tr>
        </tbody>
      </table>
      <h2>{t("Server")}</h2>
      <table className="sessions-table">
        <tbody>
          <tr><td>{t("Signed in as")}</td><td>{session?.username}</td></tr>
          <tr><td>{t("Webmail node")}</td><td>{nodeCell((n) => n.webmail)}</td></tr>
          <tr><td>{t("Mail server node")}</td><td>{nodeCell((n) => mailNodeLabel(n.mailServer))}</td></tr>
          <tr><td>{t("Accounts")}</td><td>{Object.values(session?.accounts ?? {}).map((a) => a.name).join(", ")}</td></tr>
          <tr><td>{t("Max upload")}</td><td>{t("{size} MB", { size: Math.round(client.maxSizeUpload / 1048576) })}</td></tr>
          <tr><td>{t("Image privacy proxy")}</td><td>{session?.ihasmail?.imageProxy ? t("enabled") : t("disabled")}</td></tr>
        </tbody>
      </table>
      <p className="hint" style={{ marginTop: 6 }}>{t("This webmail works with the inbuxa mail server, and sign-in refuses a server that doesn't offer what it needs.")}</p>
      <p className="hint">{tNode("{app}'s own version is the suite release it belongs to: {example} is the first release candidate of the 27.1 series. A build made between releases adds where its commit came from — the pull request it arrived through, or its short SHA if it did not come through one, as in {build}. The version deliberately says nothing about the mail server; what this build needs from the server is the line above.", { example: <strong className="notranslate" translate="no">v27.1-rc.1</strong>, build: <code>v27.1-rc.1+pr129</code> }, { app: appName })}</p>
      <h2>{t("Server capabilities")}</h2>
      <div className="row wrap gap-4">
        {caps.map((c) => <span key={c} className="chip mono" style={{ fontSize: ".78em" }}>{c.replace("urn:ietf:params:jmap:", "")}</span>)}
      </div>
    </div>
  );
}
