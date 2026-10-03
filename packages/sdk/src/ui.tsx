import React, { type ButtonHTMLAttributes, type ReactNode, useState, type SelectHTMLAttributes } from "react";
import type { HostBridge, ModelInfo } from "./types";

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return <button className={`m-button ${variant} ${className}`} {...props} />;
}
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" | "red" }) {
  return <span className={`m-badge ${tone}`}>{children}</span>;
}
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="m-page-header"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="m-header-actions">{actions}</div>}</header>;
}
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`m-panel ${className}`}>{children}</section>;
}
export function EmptyState({ title, children, description }: { title: string; children?: ReactNode; description?: string }) {
  return <div className="m-empty"><span>✳</span><h2>{title}</h2>{(children || description) && <p>{children || description}</p>}</div>;
}
export function ModelSelect({ models, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { models: ModelInfo[] }) {
  const [error, setError] = useState("");
  const subscription = models.find(m => m.id === props.value)?.kind === "chatgpt";
  const manage = () => { const bridge = (globalThis as typeof globalThis & { __MALATANG_BRIDGE__?: HostBridge }).__MALATANG_BRIDGE__; void bridge?.call("chatgpt.manageUsage", {}).catch(() => setError("无法打开 ChatGPT 用量设置")); };
  return <div className="m-model-picker"><select className="m-model-select" aria-label="选择模型" {...props} disabled={props.disabled || !models.some(model => model.configured)}>{!models.some(model => model.id === props.value) && <option value="" disabled>{models.length ? "选择可用模型" : "请先在设置中添加模型"}</option>}{models.map(model => <option value={model.id} key={model.id} disabled={!model.configured}>{model.name}{model.kind === "chatgpt" ? ` · ${model.provider}` : ""}{!model.configured ? " · 需配置" : ""}</option>)}</select>{subscription && <small className="m-plan-notice">Using ChatGPT plan <button type="button" onClick={manage}>管理用量 ↗</button></small>}{error && <small role="alert">{error}</small>}</div>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="m-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
