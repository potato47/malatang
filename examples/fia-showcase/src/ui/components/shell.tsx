import { Aperture, CheckCircle2, Files, Grid2X2, Search } from "lucide-react";
import type { ReactNode } from "react";

const navigation = [
  { href: "/", label: "工具箱", icon: Grid2X2 },
  { href: "/screenshots", label: "截图", icon: Aperture },
  { href: "/search", label: "搜索", icon: Search },
  { href: "/files", label: "文件", icon: Files },
  { href: "/capabilities", label: "能力", icon: CheckCircle2 },
];

export function Shell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const current = location.pathname;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span>
            <Grid2X2 size={16} />
          </span>
          FIA 工具箱
        </div>
        <nav>
          {navigation.map(({ href, label, icon: Icon }) => (
            <a key={href} className={current === href ? "active" : ""} href={href}>
              <Icon size={16} />
              {label}
            </a>
          ))}
        </nav>
        <div className="shortcut-note">
          <kbd>⌥ Space</kbd>
          <span>搜索</span>
          <kbd>⌃ ⇧ 4</kbd>
          <span>截图</span>
        </div>
      </aside>
      <main className="workspace">
        <header className="page-header">
          <div>
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className="header-actions">{actions}</div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
