import { Alert, Field, Popover, Select } from "@semicoder/malatang-sdk/ui";
import React, { useState } from "react";
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
  const label = options.find(option => option.value === theme)!.label;
  return <Popover open={open} onOpenChange={setOpen} side="right" align="end" sideOffset={14} trigger={<ActivityButton className={`activity-button ${open ? "active" : ""}`} label={`切换主题：${label}`} tooltipDisabled><ThemeIcon mode={theme} /></ActivityButton>}>
    <div className="theme-popover"><Field label="外观主题"><Select value={theme} disabled={!ready || pending} onChange={event => void choose(event.target.value as ThemeMode)}>{options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</Select></Field>{pending && <p role="status">正在保存…</p>}{error && <Alert>{error}</Alert>}</div>
  </Popover>;
}
