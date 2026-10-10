import React, {
  createContext,
  useContext,
  useId,
  type ReactNode,
  type ComponentProps,
  type HTMLAttributes,
} from "react";
import { Search } from "lucide-react";
import { cx } from "./utils";
export type Size = "sm" | "md" | "lg";
export type Tone = "neutral" | "success" | "warning" | "error";
export const FieldContext = createContext<{ id: string; description?: string; error?: boolean }>({
  id: "",
});
export function useControl(props: {
  id?: string;
  "aria-describedby"?: string;
  "aria-labelledby"?: string;
  "aria-label"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
}) {
  const field = useContext(FieldContext);
  return {
    id: props.id || field.id || undefined,
    "aria-labelledby":
      props["aria-labelledby"] ??
      (field.id && !props["aria-label"] ? `${field.id}-label` : undefined),
    "aria-describedby":
      [props["aria-describedby"], field.description].filter(Boolean).join(" ") || undefined,
    "aria-invalid": props["aria-invalid"] ?? (field.error || undefined),
  };
}
export function Button({
  variant = "primary",
  size = "md",
  loading,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: Size;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx("m-button ui:shrink-0", `m-${variant}`, `m-${size}`, className)}
    >
      {loading && <Loading label="处理中" />}
      {children}
    </button>
  );
}
export function IconButton({
  label,
  className,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return <Button {...props} className={cx("m-icon-button", className)} aria-label={label} />;
}
export function Input({
  size = "md",
  className,
  ...props
}: Omit<ComponentProps<"input">, "size"> & { size?: Size }) {
  return (
    <input {...props} {...useControl(props)} className={cx("m-input", `m-${size}`, className)} />
  );
}
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} {...useControl(props)} className={cx("m-textarea", className)} />;
}
export function Field({
  label,
  hint,
  error,
  children,
  id: explicitId,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  id?: string;
}) {
  const generatedId = useId();
  const id = explicitId || generatedId;
  return (
    <FieldContext.Provider
      value={{ id, error: !!error, description: error || hint ? `${id}-description` : undefined }}
    >
      <div className="m-field">
        <label id={`${id}-label`} htmlFor={id}>
          {label}
        </label>
        {children}
        {(error || hint) && (
          <small id={`${id}-description`} role={error ? "alert" : undefined}>
            {error || hint}
          </small>
        )}
      </div>
    </FieldContext.Provider>
  );
}
export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span {...props} className={cx("m-badge", `m-${tone}`, className)} />;
}
export function Alert({
  tone = "error",
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: Tone }) {
  return (
    <div
      {...props}
      role={tone === "error" ? "alert" : "status"}
      className={cx("m-alert", `m-${tone}`, className)}
    />
  );
}
export function Loading({ label = "加载中" }: { label?: string }) {
  return (
    <span className="m-loading" role="status" aria-label={label}>
      <span aria-hidden="true" />
    </span>
  );
}
export function Page({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("m-page ui:mx-auto ui:max-w-[1120px]", className)} />;
}
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="m-page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="m-header-actions">{actions}</div>}
    </header>
  );
}
export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section {...props} className={cx("m-panel", className)} />;
}
export function PanelHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("m-panel-header", className)} />;
}
export function PanelContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("m-panel-content", className)} />;
}
export function PanelFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("m-panel-footer", className)} />;
}
export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="m-empty">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}

export function InputGroup({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cx("m-input-group", className)} />;
}
export function SearchInput(props: ComponentProps<typeof Input>) {
  return (
    <InputGroup>
      <Search aria-hidden="true" size={16} />
      <Input type="search" {...props} />
    </InputGroup>
  );
}
export function SettingsGroup({
  title,
  description,
  children,
  className,
  ...props
}: Omit<ComponentProps<"section">, "title"> & { title: string; description?: string }) {
  return (
    <section {...props} className={cx("m-settings-group", className)}>
      <header>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      <div>{children}</div>
    </section>
  );
}
export function SettingsRow({
  label,
  description,
  children,
  className,
  ...props
}: ComponentProps<"div"> & { label: ReactNode; description?: ReactNode }) {
  return (
    <div {...props} className={cx("m-settings-row", className)}>
      <div>
        <div className="m-setting-label">{label}</div>
        {description && <p>{description}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} aria-hidden="true" className={cx("m-skeleton", className)} />;
}
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return <kbd {...props} className={cx("m-kbd", className)} />;
}
