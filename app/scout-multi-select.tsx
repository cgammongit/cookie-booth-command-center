"use client";

import { useEffect, useId, useRef, useState } from "react";

export type ScoutSelectOption = {
  id: number;
  name: string;
  detail?: string;
  disabled?: boolean;
};

export function ScoutMultiSelect({
  options,
  selectedIds,
  onToggle,
  triggerLabel,
  emptyMessage,
  disabled = false,
  pending = false,
}: {
  options: ScoutSelectOption[];
  selectedIds: number[];
  onToggle: (option: ScoutSelectOption) => void;
  triggerLabel: string;
  emptyMessage: string;
  disabled?: boolean;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedNames = options.filter((option) => selectedIds.includes(option.id)).map((option) => option.name);
  const summary = selectedNames.length === 0 ? "No scouts selected" : selectedNames.length === 1 ? selectedNames[0] : `${selectedNames.length} scouts selected`;

  function close({ focusTrigger = false } = {}) {
    setOpen(false);
    if (focusTrigger) queueMicrotask(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!containerRef.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return <div className="scoutMultiSelect" ref={containerRef}>
    <button ref={triggerRef} type="button" className="scoutSelectTrigger" aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} disabled={disabled || pending} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === "Escape") close({ focusTrigger: true }); }}>
      <span><strong>{triggerLabel}</strong><small>{summary}</small></span><span aria-hidden="true">{open ? "▲" : "▼"}</span>
    </button>
    {open && <div id={menuId} className="scoutSelectMenu" role="listbox" aria-label={triggerLabel} aria-multiselectable="true" onKeyDown={(event) => { if (event.key === "Escape") close({ focusTrigger: true }); }}>
      {options.map((option) => { const selected = selectedIds.includes(option.id); return <button type="button" role="option" aria-selected={selected} aria-label={`${option.name}, ${selected ? "selected" : "not selected"}`} key={option.id} disabled={pending || option.disabled} onClick={() => onToggle(option)}><span className="scoutOptionCheck" aria-hidden="true">{selected ? "✓" : ""}</span><span><strong>{option.name}</strong>{option.detail && <small>{option.detail}</small>}</span></button>; })}
      {!options.length && <div className="scoutSelectEmpty">{emptyMessage}</div>}
      <button type="button" className="scoutSelectClose" onClick={() => close({ focusTrigger: true })}>Close</button>
    </div>}
  </div>;
}
