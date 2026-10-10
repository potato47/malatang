import {
  Sun,
  Moon,
  Monitor,
  Alert,
  Field,
  Popover,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  PopoverTrigger,
  PopoverContent,
} from "@semicoder/malatang-sdk/ui";
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
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  return <Icon aria-hidden="true" />;
}
export default function ThemeControl() {
  const { theme, ready, pending, error, choose } = useTheme();
  const [open, setOpen] = useState(false);
  const label = options.find((option) => option.value === theme)!.label;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <ActivityButton
            className={`activity-button ${open ? "active" : ""}`}
            label={`切换主题：${label}`}
            tooltipDisabled
          >
            <ThemeIcon mode={theme} />
          </ActivityButton>
        }
      />
      <PopoverContent side="right" align="end" sideOffset={14}>
        <div className="theme-popover">
          <Field label="外观主题">
            <Select
              value={theme}
              disabled={!ready || pending}
              onValueChange={(value) => void choose((value ?? "") as ThemeMode)}
            >
              <SelectTrigger>
                <SelectValue placeholder="请选择" />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem value={option.value} key={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {pending && <p role="status">正在保存…</p>}
          {error && <Alert>{error}</Alert>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
