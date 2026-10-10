import React, { useEffect, useId, useState } from "react";
import {
  SettingsGroup,
  SettingsRow,
  Alert,
  Button,
  PageHeader,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@semicoder/malatang-sdk/ui";
import {
  colorThemeSchema,
  contrast,
  defaultColorTheme,
  paletteFor,
  type ColorTheme,
  type Palette,
  type ThemeMode,
} from "../shared/theme";
import { useTheme } from "./ThemeProvider";

const choices: { value: ThemeMode; title: string; description: string }[] = [
  { value: "light", title: "浅色", description: "清晰、明亮的工作空间" },
  { value: "dark", title: "深色", description: "适合低光环境" },
  { value: "system", title: "跟随系统", description: "与系统外观保持一致" },
];
const colors: { key: keyof Palette; label: string; description: string }[] = [
  { key: "accent", label: "强调色", description: "主要按钮与操作" },
  { key: "background", label: "背景", description: "页面、输入区域与浮层的基色" },
  { key: "foreground", label: "前景", description: "文字与图标的基色" },
];

export default function AppearanceSettings({ visible = true }: { visible?: boolean }) {
  const { theme, colorTheme, resolved, choose, saveColors, previewColors, ready, pending, error } =
    useTheme();
  const [draft, setDraft] = useState(colorTheme);
  const [saved, setSaved] = useState(false);
  const id = useId();
  const savedColors = JSON.stringify(colorTheme);
  const changed = JSON.stringify(draft) !== savedColors;
  const parsed = colorThemeSchema.safeParse(draft);
  const palette = paletteFor(draft, resolved);
  const validation = !parsed.success ? parsed.error.issues[0]!.message : "";
  const ratio =
    /^#[0-9a-f]{6}$/i.test(palette.background) && /^#[0-9a-f]{6}$/i.test(palette.foreground)
      ? contrast(palette.background, palette.foreground).toFixed(1)
      : "—";
  useEffect(() => {
    setDraft(JSON.parse(savedColors) as ColorTheme);
  }, [savedColors, visible]);
  useEffect(() => {
    if (visible && changed && colorThemeSchema.safeParse(draft).success) previewColors(draft);
    else previewColors(null);
    return () => previewColors(null);
  }, [visible, changed, draft, previewColors]);
  const edit = (key: keyof Palette, value: string) => {
    setSaved(false);
    setDraft((current) => ({
      preset: "custom",
      custom: {
        light: { ...paletteFor(current, "light") },
        dark: { ...paletteFor(current, "dark") },
        [resolved]: { ...paletteFor(current, resolved), [key]: value.toUpperCase() },
      },
    }));
  };
  return (
    <div className="settings-page">
      <PageHeader title="外观" description="为所有插件选择统一的界面主题。" />
      <SettingsGroup title="模式">
        <SettingsRow label="明暗模式" description="应用内容与原生标题栏共同切换，更改自动保存。">
          <span>{choices.find((choice) => choice.value === theme)?.title}</span>
        </SettingsRow>
      </SettingsGroup>
      <div className="appearance-choices">
        {choices.map((choice) => (
          <Button
            variant="secondary"
            key={choice.value}
            className={`appearance-choice ${theme === choice.value ? "selected" : ""}`}
            aria-pressed={theme === choice.value}
            disabled={!ready || pending}
            onClick={() => {
              setSaved(false);
              void choose(choice.value);
            }}
          >
            <span className={`appearance-preview ${choice.value}`} aria-hidden="true">
              <i />
              <span>
                <b />
                <b />
                <b />
              </span>
            </span>
            <strong>
              {choice.title}
              <span>{theme === choice.value ? "✓" : ""}</span>
            </strong>
            <small>{choice.description}</small>
          </Button>
        ))}
      </div>
      <div className="appearance-palette">
        <SettingsGroup title="配色主题" description="配色仅应用于内容区；原生标题栏保持明暗模式。">
          <SettingsRow
            label={<label id={`${id}-preset`}>主题</label>}
            description="更改会在当前窗口即时预览，保存后同步到其他窗口。"
          >
            <Select
              value={draft.preset}
              disabled={!ready || pending}
              onValueChange={(value) => {
                if (value) {
                  setDraft((current) => ({ ...current, preset: value as ColorTheme["preset"] }));
                  setSaved(false);
                }
              }}
            >
              <SelectTrigger aria-labelledby={`${id}-preset`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认</SelectItem>
                <SelectItem value="github">GitHub</SelectItem>
                <SelectItem value="custom">自定义</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
          {colors.map(({ key, label, description }) => (
            <SettingsRow
              key={key}
              label={<label htmlFor={`${id}-${key}`}>{label}</label>}
              description={description}
            >
              <div className="theme-color-input">
                <input
                  type="color"
                  aria-label={`选择${label}颜色`}
                  disabled={!ready || pending}
                  value={/^#[0-9a-f]{6}$/i.test(palette[key]) ? palette[key] : "#000000"}
                  onChange={(event) => edit(key, event.target.value)}
                />
                <Input
                  id={`${id}-${key}`}
                  value={palette[key]}
                  spellCheck={false}
                  maxLength={7}
                  aria-invalid={!!validation}
                  aria-describedby={validation ? `${id}-error` : undefined}
                  disabled={!ready || pending}
                  onChange={(event) => edit(key, event.target.value)}
                />
              </div>
            </SettingsRow>
          ))}
        </SettingsGroup>
        <p className="settings-note">
          正在编辑{resolved === "dark" ? "深色" : "浅色"}配色 · 文字对比度 {ratio}
          :1。切换明暗模式可分别设置。
        </p>
        {validation && <Alert id={`${id}-error`}>{validation}</Alert>}
        <div className="appearance-actions">
          <Button
            variant="ghost"
            disabled={!ready || pending}
            onClick={() => {
              setDraft(defaultColorTheme());
              setSaved(false);
            }}
          >
            恢复默认
          </Button>
          <span role="status">
            {pending ? "正在保存…" : changed ? "尚未保存" : saved ? "配色已保存" : ""}
          </span>
          <Button
            variant="secondary"
            disabled={!changed || pending}
            onClick={() => {
              setDraft(colorTheme);
              setSaved(false);
            }}
          >
            取消
          </Button>
          <Button
            disabled={!ready || pending || !changed || !parsed.success}
            onClick={async () => {
              if (await saveColors(draft)) setSaved(true);
            }}
          >
            保存配色
          </Button>
        </div>
        <p className="settings-note">离开外观设置会取消未保存的预览。</p>
      </div>
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
