import ComponentGallery from "./ComponentGallery";
import { SlidersHorizontal, Sun, RefreshCw, Blocks, Button } from "@semicoder/malatang-sdk/ui";
import React, { useState } from "react";
import AppearanceSettings from "./AppearanceSettings";
import ModelSettings from "./ModelSettings";
import PageSlot from "./PageSlot";
import UpdateSettings from "./UpdateSettings";

export default function Settings({ visible = true }: { visible?: boolean }) {
  const [section, setSection] = useState("models");
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类">
        <h1>设置</h1>
        <p>管理你的工作空间</p>
        <Button
          variant="ghost"
          className={section === "models" ? "selected" : ""}
          aria-current={section === "models" ? "page" : undefined}
          onClick={() => setSection("models")}
        >
          <SlidersHorizontal aria-hidden="true" />
          模型服务
        </Button>
        <Button
          variant="ghost"
          className={section === "appearance" ? "selected" : ""}
          aria-current={section === "appearance" ? "page" : undefined}
          onClick={() => setSection("appearance")}
        >
          <Sun aria-hidden="true" />
          外观
        </Button>
        <Button
          variant="ghost"
          className={section === "updates" ? "selected" : ""}
          aria-current={section === "updates" ? "page" : undefined}
          onClick={() => setSection("updates")}
        >
          <RefreshCw aria-hidden="true" />
          应用更新
        </Button>
        {import.meta.env.DEV && (
          <Button
            variant="ghost"
            aria-current={section === "components" ? "page" : undefined}
            onClick={() => setSection("components")}
          >
            <Blocks aria-hidden="true" />
            组件样例
          </Button>
        )}
      </nav>
      <div className="settings-main">
        {import.meta.env.DEV && (
          <PageSlot visible={section === "components"} keepAlive label="组件样例">
            <ComponentGallery />
          </PageSlot>
        )}
        <PageSlot visible={section === "models"} keepAlive label="模型服务">
          <ModelSettings />
        </PageSlot>
        <PageSlot visible={section === "appearance"} keepAlive label="外观">
          <AppearanceSettings visible={visible && section === "appearance"} />
        </PageSlot>
        <PageSlot visible={section === "updates"} keepAlive={false} label="应用更新">
          <UpdateSettings />
        </PageSlot>
      </div>
    </div>
  );
}
