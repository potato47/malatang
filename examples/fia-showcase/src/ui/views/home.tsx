import { Aperture, CheckCircle2, Files, Search, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { FileRoot, ScreenshotRecord, WindowName } from "../../shared/contracts";
import { errorMessage, jsonRequest, requestJSON } from "../api";
import { Alert, Spinner } from "../components/common";
import { Shell } from "../components/shell";

interface Overview {
  screenshots: ScreenshotRecord[];
  roots: FileRoot[];
  recentSearches: Array<{ query: string; searchedAt: string; resultCount: number }>;
}

const tools: Array<{
  id: WindowName;
  title: string;
  description: string;
  icon: typeof Aperture;
  accent: string;
}> = [
  {
    id: "screenshots",
    title: "截图",
    description: "整屏、跨显示器区域选择与历史管理",
    icon: Aperture,
    accent: "violet",
  },
  {
    id: "search",
    title: "文件搜索",
    description: "使用 Spotlight 元数据快速定位本机文件",
    icon: Search,
    accent: "blue",
  },
  {
    id: "files",
    title: "文件管理",
    description: "多根目录、预览与安全的日常文件操作",
    icon: Files,
    accent: "amber",
  },
  {
    id: "capabilities",
    title: "能力中心",
    description: "查看并验证 FIA 原生能力与授权状态",
    icon: CheckCircle2,
    accent: "green",
  },
];

export function HomeView() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void requestJSON<Overview>("/api/overview")
      .then(setOverview)
      .catch((reason) => setError(errorMessage(reason)));
  }, []);

  const open = async (name: WindowName) => {
    try {
      await requestJSON(`/api/windows/${name}`, jsonRequest("POST"));
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <Shell title="今天想做什么？" subtitle="一个真实项目，持续验证 FIA 的桌面能力边界。">
      {error ? <Alert>{error}</Alert> : null}
      <section className="hero-panel">
        <div>
          <span className="eyebrow">
            <Sparkles size={14} /> Resident Bun service
          </span>
          <h2>
            原生入口，Web 技术栈，
            <br />
            普通协议边界。
          </h2>
          <p>
            状态栏 Host 管理窗口与系统能力；React 页面只通过 HTTP 和 WebSocket 与常驻 Backend 通信。
          </p>
        </div>
        <div className="hero-stats">
          {overview === null ? (
            <Spinner />
          ) : (
            <>
              <div>
                <strong>{overview.screenshots.length}</strong>
                <span>最近截图</span>
              </div>
              <div>
                <strong>{overview.roots.length}</strong>
                <span>文件根目录</span>
              </div>
              <div>
                <strong>{overview.recentSearches.length}</strong>
                <span>最近搜索</span>
              </div>
            </>
          )}
        </div>
      </section>
      <section className="tool-grid">
        {tools.map(({ id, title, description, icon: Icon, accent }) => (
          <button key={id} className="tool-card" onClick={() => void open(id)}>
            <span className={`tool-icon ${accent}`}>
              <Icon size={21} />
            </span>
            <span>
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
            <span className="card-arrow">↗</span>
          </button>
        ))}
      </section>
      <section className="info-strip">
        <div>
          <strong>会话安全</strong>
          <span>一次性 bootstrap + HttpOnly cookie</span>
        </div>
        <div>
          <strong>持久化</strong>
          <span>bun:sqlite · app.dataDirectory</span>
        </div>
        <div>
          <strong>实时状态</strong>
          <span>同源 WebSocket 事件流</span>
        </div>
      </section>
    </Shell>
  );
}
