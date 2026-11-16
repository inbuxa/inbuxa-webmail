import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useMail } from "@/store/mail";
import { keyboard } from "@/lib/input/keyboard";
import { DateField } from "@/ui/datefield";
import { t } from "@/lib/i18n";

/*
 * One bar, two searches. In the calendar it searches events
 * (`/calendar/search?q=`), with no advanced panel: mail's operators mean
 * nothing to an event, and keyword filters for events are left for later.
 * Everywhere else it searches mail.
 */
export function SearchBar() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const events = location.startsWith("/calendar");
  const resultsPath = events ? "/calendar/search" : "/search";
  const [q, setQ] = useState("");
  const [adv, setAdv] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const mailboxes = useMail((s) => s.mailboxes);
  const [advFields, setAdvFields] = useState({ from: "", to: "", subject: "", words: "", hasAttachment: false, unread: false, folder: "", after: "", before: "" });

  // Sync from URL when on a results page
  useEffect(() => {
    if (location.startsWith(resultsPath)) {
      const params = new URLSearchParams(search);
      setQ(params.get("q") ?? "");
    } else setQ("");
  }, [location, search, resultsPath]);

  // The bar stays on screen from page to page, so the panel would too.
  useEffect(() => setAdv(false), [location]);

  /*
   * The panel closes on a tap or click outside it and on Escape, as a menu
   * does. A date picker opened from it lives in a portal elsewhere in the
   * page, so a tap there counts as inside; it handles its own Escape first.
   */
  useEffect(() => {
    if (!adv) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Element | null;
      if (formRef.current?.contains(target) || target?.closest?.(".popover")) return;
      setAdv(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAdv(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [adv]);

  useEffect(() => keyboard.pushScope("search", [{ keys: "/", description: "Search mail", group: "Navigation", handler: () => inputRef.current?.focus() }]), []);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const query = q.trim();
    if (!query) return;
    setAdv(false);
    navigate(`${resultsPath}?q=${encodeURIComponent(query)}`);
    inputRef.current?.blur();
  };

  const applyAdvanced = () => {
    const parts: string[] = [];
    const f = advFields;
    if (f.from) parts.push(`from:${quote(f.from)}`);
    if (f.to) parts.push(`to:${quote(f.to)}`);
    if (f.subject) parts.push(`subject:${quote(f.subject)}`);
    if (f.words) parts.push(f.words);
    if (f.hasAttachment) parts.push("has:attachment");
    if (f.unread) parts.push("is:unread");
    if (f.folder) parts.push(`in:${quote(f.folder)}`);
    if (f.after) parts.push(`after:${f.after}`);
    if (f.before) parts.push(`before:${f.before}`);
    const query = parts.join(" ");
    setQ(query);
    setAdv(false);
    if (query) navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  return (
    <form ref={formRef} className="searchbar" role="search" onSubmit={submit}>
      <div className="search-input">
        <Search size={18} className="muted" />
        <input ref={inputRef} type="search" placeholder={events ? t("Search events") : t("Search mail  (from:, to:, subject:, has:attachment, is:unread, in:, before:, after:)")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={events ? t("Search events") : t("Search mail")} enterKeyHint="search" />
        {q && (
          <button type="button" className="icon-btn sm" aria-label={t("Clear")} onClick={() => { setQ(""); if (location.startsWith(resultsPath)) navigate(events ? "/calendar" : "/mail"); }}>
            <X size={16} />
          </button>
        )}
        {!events && (
          <button type="button" className={`icon-btn sm ${adv ? "active" : ""}`} aria-label={t("Advanced search")} title={t("Advanced search")} onClick={() => setAdv((v) => !v)}>
            <SlidersHorizontal size={16} />
          </button>
        )}
      </div>
      {adv && !events && (
        <div className="search-panel">
          <div className="grid">
            <label className="field"><span className="label">{t("From")}</span><input className="input sm" value={advFields.from} onChange={(e) => setAdvFields({ ...advFields, from: e.target.value })} /></label>
            <label className="field"><span className="label">{t("To")}</span><input className="input sm" value={advFields.to} onChange={(e) => setAdvFields({ ...advFields, to: e.target.value })} /></label>
            <label className="field"><span className="label">{t("Subject")}</span><input className="input sm" value={advFields.subject} onChange={(e) => setAdvFields({ ...advFields, subject: e.target.value })} /></label>
            <label className="field"><span className="label">{t("Has the words")}</span><input className="input sm" value={advFields.words} onChange={(e) => setAdvFields({ ...advFields, words: e.target.value })} /></label>
            <label className="field"><span className="label">{t("Folder")}</span>
              <select className="select" style={{ height: 32 }} value={advFields.folder} onChange={(e) => setAdvFields({ ...advFields, folder: e.target.value })}>
                <option value="">{t("All mail")}</option>
                {Object.values(mailboxes).sort((a, b) => a.name.localeCompare(b.name)).map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select>
            </label>
            <div className="field"><span className="label">{t("Date")}</span>
              <div className="row"><DateField aria-label={t("After")} value={advFields.after} onChange={(v) => setAdvFields({ ...advFields, after: v })} /><span className="muted">{t("to")}</span><DateField aria-label={t("Before")} value={advFields.before} onChange={(v) => setAdvFields({ ...advFields, before: v })} /></div>
            </div>
          </div>
          <div className="row search-panel-foot">
            <div className="row gap-16">
              <label className="check"><input type="checkbox" checked={advFields.hasAttachment} onChange={(e) => setAdvFields({ ...advFields, hasAttachment: e.target.checked })} />  {t("Has attachment")}</label>
              <label className="check"><input type="checkbox" checked={advFields.unread} onChange={(e) => setAdvFields({ ...advFields, unread: e.target.checked })} />  {t("Unread only")}</label>
            </div>
            <div className="row search-panel-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setAdv(false)}>{t("Cancel")}</button>
              <button type="button" className="btn btn-primary" onClick={applyAdvanced}>{t("Search")}</button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}

function quote(s: string): string {
  return /\s/.test(s) ? `"${s.replace(/"/g, "")}"` : s;
}
