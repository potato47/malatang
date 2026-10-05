import ComponentGallery from "./ComponentGallery";
import { Alert, Button, Page, PageHeader } from "@semicoder/malatang-sdk/ui";
import React, { useState } from "react";
import type { ThemeMode } from "../shared/api";
import { useTheme } from "./ThemeProvider";
import ModelSettings from "./ModelSettings";
import PageSlot from "./PageSlot";
import UpdateSettings from "./UpdateSettings";

function AppearanceSettings() {
  const { theme, choose, ready, pending, error } = useTheme();
  const choices: { value: ThemeMode; title: string; description: string }[] = [
    { value: "light", title: "浅色", description: "清晰、明亮的工作空间" },
    { value: "dark", title: "深色", description: "适合低光环境" },
    { value: "system", title: "跟随系统", description: "与系统外观保持一致" },
  ];
  return <div className="settings-page"><PageHeader title="外观" description="为所有插件选择统一的界面主题。" />
    <h2 className="settings-section-title">颜色主题</h2><div className="appearance-choices">{choices.map(choice => <Button variant="secondary" key={choice.value} className={`appearance-choice ${theme === choice.value ? "selected" : ""}`} aria-pressed={theme === choice.value} disabled={!ready || pending} onClick={() => void choose(choice.value)}>
      <span className={`appearance-preview ${choice.value}`} aria-hidden="true"><i /><span><b /><b /><b /></span></span>
      <strong>{choice.title}<span>{theme === choice.value ? "✓" : ""}</span></strong><small>{choice.description}</small>
    </Button>)}</div><p className="settings-note">外观更改会自动保存，并同步到应用窗口和各个插件。</p>{error && <Alert>{error}</Alert>}
  </div>;
}

export default function Settings() {
  const [section, setSection] = useState("models");
  return <div className="settings-layout">
    <nav className="settings-nav" aria-label="设置分类"><h1>设置</h1><p>管理你的工作空间</p>
      <Button variant="ghost" className={section === "models" ? "selected" : ""} aria-current={section === "models" ? "page" : undefined} onClick={() => setSection("models")}><span aria-hidden="true">◈</span>模型服务</Button>
      <Button variant="ghost" className={section === "appearance" ? "selected" : ""} aria-current={section === "appearance" ? "page" : undefined} onClick={() => setSection("appearance")}><span aria-hidden="true">◐</span>外观</Button>
      <Button variant="ghost" className={section === "updates" ? "selected" : ""} aria-current={section === "updates" ? "page" : undefined} onClick={() => setSection("updates")}><span aria-hidden="true">↻</span>应用更新</Button>
      {import.meta.env.DEV && <Button variant="ghost" aria-current={section === "components" ? "page" : undefined} onClick={() => setSection("components")}>组件样例</Button>}
    </nav>
    <div className="settings-main">{import.meta.env.DEV && <PageSlot visible={section === "components"} keepAlive label="组件样例"><ComponentGallery /></PageSlot>}<PageSlot visible={section === "models"} keepAlive label="模型服务"><ModelSettings /></PageSlot><PageSlot visible={section === "appearance"} keepAlive label="外观"><AppearanceSettings /></PageSlot><PageSlot visible={section === "updates"} keepAlive={false} label="应用更新"><UpdateSettings /></PageSlot></div>
  </div>;
}
