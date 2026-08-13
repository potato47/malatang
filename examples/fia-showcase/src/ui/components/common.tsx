import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle, X } from "lucide-react";

export function Button({
  children,
  className = "",
  loading = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button className={`button ${className}`} disabled={props.disabled || loading} {...props}>
      {loading ? <LoaderCircle className="spin" size={15} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button className="icon-button" aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  );
}

export function Alert({
  children,
  tone = "error",
}: {
  children: ReactNode;
  tone?: "error" | "info";
}) {
  return <div className={`alert ${tone}`}>{children}</div>;
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <IconButton label="关闭" onClick={onClose}>
            <X size={17} />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}

export function Spinner({ label = "正在加载" }: { label?: string }) {
  return (
    <div className="spinner">
      <LoaderCircle className="spin" size={18} />
      {label}
    </div>
  );
}
