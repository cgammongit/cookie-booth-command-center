"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { calculateScoutMenuPlacement, type ScoutMenuPlacement } from "@/lib/scout-menu-position";

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
  const [placement, setPlacement] = useState<ScoutMenuPlacement | null>(null);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedNames = options.filter((option) => selectedIds.includes(option.id)).map((option) => option.name);
  const summary = selectedNames.length === 0 ? "No scouts selected" : selectedNames.length === 1 ? selectedNames[0] : `${selectedNames.length} scouts selected`;

  function close({ focusTrigger = false } = {}) {
    setOpen(false);
    setPlacement(null);
    if (focusTrigger) queueMicrotask(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const updatePosition = () => {
      frame = 0;
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const desiredHeight = Math.min(menu.scrollHeight, 320);
      setPlacement(calculateScoutMenuPlacement(
        trigger.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        desiredHeight,
      ));
    };
    const schedulePosition = () => {
      if (!frame) frame = window.requestAnimationFrame(updatePosition);
    };
    schedulePosition();
    window.addEventListener("resize", schedulePosition);
    window.addEventListener("scroll", schedulePosition, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedulePosition);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    if (menuRef.current) observer?.observe(menuRef.current);
    return () => {
      window.removeEventListener("resize", schedulePosition);
      window.removeEventListener("scroll", schedulePosition, true);
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [open, options.length]);

  const menu = open && typeof document !== "undefined" ? <div
    ref={menuRef}
    id={menuId}
    className="scoutSelectMenu"
    role="listbox"
    aria-label={triggerLabel}
    aria-multiselectable="true"
    data-placement={placement?.side}
    style={placement ? { left: placement.left, top: placement.top, width: placement.width, maxHeight: placement.maxHeight, visibility: "visible" } : { visibility: "hidden" }}
    onKeyDown={(event) => { if (event.key === "Escape") close({ focusTrigger: true }); }}
  >
    {options.map((option) => { const selected = selectedIds.includes(option.id); return <button type="button" role="option" aria-selected={selected} aria-label={`${option.name}, ${selected ? "selected" : "not selected"}`} key={option.id} disabled={pending || option.disabled} onClick={() => onToggle(option)}><span className="scoutOptionCheck" aria-hidden="true">{selected ? "✓" : ""}</span><span><strong>{option.name}</strong>{option.detail && <small>{option.detail}</small>}</span></button>; })}
    {!options.length && <div className="scoutSelectEmpty">{emptyMessage}</div>}
    <button type="button" className="scoutSelectClose" onClick={() => close({ focusTrigger: true })}>Close</button>
  </div> : null;

  return <div className="scoutMultiSelect" ref={containerRef}>
    <button ref={triggerRef} type="button" className="scoutSelectTrigger" aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} aria-owns={open ? menuId : undefined} disabled={disabled || pending} onClick={() => open ? close() : setOpen(true)} onKeyDown={(event) => { if (event.key === "Escape") close({ focusTrigger: true }); }}>
      <span><strong>{triggerLabel}</strong><small>{summary}</small></span><span aria-hidden="true">{open ? "▲" : "▼"}</span>
    </button>
    {menu && createPortal(menu, document.body)}
  </div>;
}
