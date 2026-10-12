"use client";
export function WorkspaceTabs({ id, tabs, selected, onSelect, label }: { id: string; tabs: { id: string; label: string }[]; selected: string; onSelect: (id: string) => void; label: string }) {
  return <div className="workspace-tabs" role="tablist" aria-label={label}>{tabs.map((tab, index) => <button key={tab.id} type="button" role="tab" id={`${id}-tab-${tab.id}`} aria-selected={selected === tab.id} aria-controls={`${id}-panel-${tab.id}`} tabIndex={selected === tab.id ? 0 : -1} onClick={() => onSelect(tab.id)} onKeyDown={event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const target = tabs[next]!; onSelect(target.id); document.getElementById(`${id}-tab-${target.id}`)?.focus();
  }}>{tab.label}</button>)}</div>;
}
