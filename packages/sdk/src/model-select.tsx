import React, { useState, type ComponentProps } from "react";
import { Alert, Button, Select } from "./ui";
import type { HostBridge, ModelInfo } from "./types";
export function ModelSelect({ models, ...props }: ComponentProps<typeof Select> & { models: ModelInfo[] }) {
  const [error, setError] = useState("");
  const subscription = models.find(m => m.id === props.value)?.kind === "chatgpt";
  const manage = () => { const bridge = (globalThis as typeof globalThis & { __MALATANG_BRIDGE__?: HostBridge }).__MALATANG_BRIDGE__; void bridge?.call("chatgpt.manageUsage", {}).catch(() => setError("无法打开 ChatGPT 用量设置")); };
  return <div className="m-model-picker"><Select aria-label="选择模型" {...props} disabled={props.disabled || !models.some(model => model.configured)}>{!models.some(model => model.id === props.value) && <option value="" disabled>{models.length ? "选择可用模型" : "请先在设置中添加模型"}</option>}{models.map(model => <option value={model.id} key={model.id} disabled={!model.configured}>{model.name}{model.kind === "chatgpt" ? ` · ${model.provider}` : ""}{!model.configured ? " · 需配置" : ""}</option>)}</Select>{subscription && <small>Using ChatGPT plan <Button variant="ghost" size="sm" onClick={manage}>管理用量 ↗</Button></small>}{error && <Alert>{error}</Alert>}</div>;
}
