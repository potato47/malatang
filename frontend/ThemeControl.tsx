import React, { useEffect, useRef, useState } from "react";
import type { ThemeMode } from "../shared/api";
import { useTheme } from "./ThemeProvider";
import ActivityButton from "./ActivityButton";

const options: { value: ThemeMode; label: string; hint: string }[] = [
  { value: "light", label: "浅色", hint: "明亮、柔和的工作空间" },
  { value: "dark", label: "深色", hint: "适合低光环境" },
  { value: "system", label: "跟随系统", hint: "随系统外观自动切换" },
];
function ThemeIcon({ mode }: { mode: ThemeMode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    {mode === "light" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></> : mode === "dark" ? <path d="M20 14a8.3 8.3 0 0 1-10-10 8.5 8.5 0 1 0 10 10Z" /> : <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>}
  </svg>;
}
export default function ThemeControl() {
  const { theme, ready, pending, error, choose } = useTheme();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    container.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const label = options.find(option => option.value === theme)!.label;
  return <div className="theme-control" ref={container} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <ActivityButton ref={trigger} className={`activity-button ${open ? "active" : ""}`} label={`切换主题：${label}`} tooltipDisabled={open} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? "theme-picker" : undefined} onClick={() => setOpen(value => !value)}><ThemeIcon mode={theme} />{error && <span className="theme-error-dot" />}</ActivityButton>
    {open && <div className="theme-popover" id="theme-picker" role="dialog" aria-label="外观主题">
      <fieldset disabled={!ready} aria-busy={pending}><legend>外观主题</legend>{options.map(option => <label className={`theme-option ${theme === option.value ? "selected" : ""}`} key={option.value}>
        <ThemeIcon mode={option.value} /><span><strong>{option.label}</strong><small>{option.hint}</small></span>
        <input type="radio" name="appearance-theme" value={option.value} checked={theme === option.value} onChange={() => void choose(option.value)} aria-label={option.label} />
      </label>)}</fieldset>
      {pending && <p className="theme-hint" role="status">正在保存…</p>}
      {error && <p className="theme-error" role="alert">{error}</p>}
    </div>}
  </div>;
}
