import React, { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode, type ComponentProps, type HTMLAttributes } from "react";
import { Dialog as RD, DropdownMenu as RM, Popover as RP, Tooltip as RT } from "radix-ui";
export { ModelSelect } from "./model-select";
const cx = (...values: (string | undefined | false)[]) => values.filter(Boolean).join(" ");
type Size = "sm" | "md";
type Tone = "neutral" | "success" | "warning" | "error";
const FieldContext = createContext<{ id: string; description?: string; error?: boolean }>({ id: "" });
function useControl(props: { id?: string; "aria-describedby"?: string; "aria-invalid"?: React.AriaAttributes["aria-invalid"] }) {
  const field = useContext(FieldContext);
  return { id: props.id || field.id || undefined, "aria-describedby": [props["aria-describedby"], field.description].filter(Boolean).join(" ") || undefined, "aria-invalid": props["aria-invalid"] ?? (field.error || undefined) };
}
export function Button({ variant = "primary", size = "md", loading, disabled, className, children, type = "button", ...props }: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: Size; loading?: boolean }) {
  return <button {...props} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={cx("m-button", `m-${variant}`, `m-${size}`, className)}>{loading && <Loading label="处理中" />}{children}</button>;
}
export function IconButton({ label, className, ...props }: ComponentProps<typeof Button> & { label: string }) { return <Button {...props} className={cx("m-icon-button", className)} aria-label={label} />; }
export function Input({ size = "md", className, ...props }: Omit<ComponentProps<"input">, "size"> & { size?: Size }) { return <input {...props} {...useControl(props)} className={cx("m-input", `m-${size}`, className)} />; }
export function Textarea({ className, ...props }: ComponentProps<"textarea">) { return <textarea {...props} {...useControl(props)} className={cx("m-textarea", className)} />; }
export function Select({ size = "md", className, ...props }: Omit<ComponentProps<"select">, "size"> & { size?: Size }) { return <select {...props} {...useControl(props)} className={cx("m-select", `m-${size}`, className)} />; }
export function Checkbox({ className, ...props }: Omit<ComponentProps<"input">, "type" | "size">) { return <input {...props} {...useControl(props)} type="checkbox" className={cx("m-checkbox", className)} />; }
export function Switch({ checked, onCheckedChange, className, disabled, ...props }: Omit<ComponentProps<"button">, "onChange" | "onClick" | "role" | "type"> & { checked: boolean; onCheckedChange: (value: boolean) => void }) { return <button {...props} {...useControl(props)} type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onCheckedChange(!checked)} className={cx("m-switch", className)}><span /></button>; }
export function Field({ label, hint, error, children, id: explicitId }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; id?: string }) {
  const generatedId = useId(); const id = explicitId || generatedId;
  return <FieldContext.Provider value={{ id, error: !!error, description: error || hint ? `${id}-description` : undefined }}><div className="m-field"><label htmlFor={id}>{label}</label>{children}{(error || hint) && <small id={`${id}-description`} role={error ? "alert" : undefined}>{error || hint}</small>}</div></FieldContext.Provider>;
}
export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) { return <span {...props} className={cx("m-badge", `m-${tone}`, className)} />; }
export function Alert({ tone = "error", className, ...props }: HTMLAttributes<HTMLDivElement> & { tone?: Tone }) { return <div {...props} role={tone === "error" ? "alert" : "status"} className={cx("m-alert", `m-${tone}`, className)} />; }
export function Loading({ label = "加载中" }: { label?: string }) { return <span className="m-loading" role="status" aria-label={label}><span aria-hidden="true" /></span>; }
export function Page({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={cx("m-page", className)} />; }
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) { return <header className="m-page-header"><div>{eyebrow && <div className="m-eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="m-header-actions">{actions}</div>}</header>; }
export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) { return <section {...props} className={cx("m-panel", className)} />; }
export function PanelHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={cx("m-panel-header", className)} />; }
export function PanelContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={cx("m-panel-content", className)} />; }
export function PanelFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={cx("m-panel-footer", className)} />; }
export function EmptyState({ title, description, children }: { title: string; description?: string; children?: ReactNode }) { return <div className="m-empty"><h2>{title}</h2>{description && <p>{description}</p>}{children}</div>; }
const PageContext = createContext<{ visible: boolean; portal: HTMLDivElement | null }>({ visible: true, portal: null });
/** A nested scope inherits parent visibility. Hiding a retained page unmounts all its portals. */
export function UIProvider({ visible = true, children }: { visible?: boolean; children: ReactNode }) {
  const parent = useContext(PageContext); const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  return <PageContext.Provider value={{ visible: parent.visible && visible, portal }}>{children}<div ref={setPortal} className="m-portals" /></PageContext.Provider>;
}
function useOverlay(open?: boolean, onOpenChange?: (open: boolean) => void) {
  const scope = useContext(PageContext); const [local, setLocal] = useState(false); const visible = useRef(scope.visible); visible.current = scope.visible;
  const change = (value: boolean) => { setLocal(value); onOpenChange?.(value); };
  useEffect(() => { if (!scope.visible && (open ?? local)) change(false); }, [scope.visible, open, local]);
  return { scope, open: scope.visible && (open ?? local), change, restore: (event: Event) => { if (!visible.current) event.preventDefault(); } };
}
type OverlayProps = { trigger: React.ReactElement; children: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void };
export function Popover({ trigger, children, open, onOpenChange }: OverlayProps) { const state = useOverlay(open, onOpenChange); return <RP.Root open={state.open} onOpenChange={state.change}><RP.Trigger asChild>{trigger}</RP.Trigger>{state.scope.visible && <RP.Portal container={state.scope.portal}><RP.Content className="m-popover" sideOffset={6} onCloseAutoFocus={state.restore}>{children}</RP.Content></RP.Portal>}</RP.Root>; }
export function Dialog({ trigger, children, title, description, open, onOpenChange }: OverlayProps & { title: string; description: string }) { const state = useOverlay(open, onOpenChange); return <RD.Root open={state.open} onOpenChange={state.change}><RD.Trigger asChild>{trigger}</RD.Trigger>{state.scope.visible && <RD.Portal container={state.scope.portal}><RD.Overlay className="m-dialog-overlay" /><RD.Content className="m-dialog" onCloseAutoFocus={state.restore}><RD.Title>{title}</RD.Title><RD.Description>{description}</RD.Description>{children}<RD.Close asChild><Button variant="secondary">关闭</Button></RD.Close></RD.Content></RD.Portal>}</RD.Root>; }
export function Menu({ trigger, children, open, onOpenChange }: OverlayProps) { const state = useOverlay(open, onOpenChange); return <RM.Root open={state.open} onOpenChange={state.change}><RM.Trigger asChild>{trigger}</RM.Trigger>{state.scope.visible && <RM.Portal container={state.scope.portal}><RM.Content className="m-menu" sideOffset={6} onCloseAutoFocus={state.restore}>{children}</RM.Content></RM.Portal>}</RM.Root>; }
export function MenuItem({ className, ...props }: ComponentProps<typeof RM.Item>) { return <RM.Item {...props} className={cx("m-menu-item", className)} />; }
export function Tooltip({ children, content }: { children: React.ReactElement; content: ReactNode }) { const state = useOverlay(); return <RT.Provider delayDuration={400}><RT.Root open={state.open} onOpenChange={state.change}><RT.Trigger asChild>{children}</RT.Trigger>{state.scope.visible && <RT.Portal container={state.scope.portal}><RT.Content className="m-tooltip" side="right" sideOffset={8}>{content}</RT.Content></RT.Portal>}</RT.Root></RT.Provider>; }
