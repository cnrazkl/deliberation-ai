type DisclosureIcon = "prompt" | "knowledge" | "attachment" | "context" | "risk" | "limits" | "council";

const paths: Record<DisclosureIcon, string> = {
  prompt: "M4 5h10M4 9h7M4 13h5M12 17l1-4 5-5 3 3-5 5-4 1Z",
  knowledge: "M4 4h6a3 3 0 0 1 3 3v13a4 4 0 0 0-4-2H4V4Zm18 0h-6a3 3 0 0 0-3 3v13a4 4 0 0 1 4-2h5V4Z",
  attachment: "m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9M6 15l9-9",
  context: "M4 4h16v12H8l-4 4V4Zm4 4h8M8 12h5",
  risk: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm0 5v5m0 3v.01",
  limits: "M4 7h16M4 17h16M8 4v6M16 14v6",
  council: "M9 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 11v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m3 3a5 5 0 0 1 3 4v3",
};

// Native summary owns keyboard activation and expanded semantics; decoration is inert.
export function DisclosureSummary({ title, description, icon, status }: {
  title: string;
  description: string;
  icon: DisclosureIcon;
  status?: string | undefined;
}) {
  return <summary className="disclosure-summary">
    <span className="disclosure-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[icon]} /></svg></span>
    <span className="disclosure-copy"><span className="disclosure-title">{title}</span><span className="disclosure-description">{description}</span></span>
    {status && <span className="disclosure-status">{status}</span>}
    <svg className="disclosure-chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 5 7 7-7 7" /></svg>
  </summary>;
}
