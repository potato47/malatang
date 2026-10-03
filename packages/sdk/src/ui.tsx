import React, { type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import type { ModelInfo } from "./types";

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
  return <select className="m-model-select" aria-label="选择模型" {...props}>{models.map(model => <option value={model.id} key={model.id}>{model.name}{model.kind === "demo" ? " · 演示" : ""}</option>)}</select>;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="m-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
