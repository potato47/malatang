import React, { Component, useEffect, useState } from "react";
import type { PluginInfo } from "@malatang/sdk/types";
import { EmptyState } from "@malatang/sdk/ui";
class Boundary extends Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <div className="m-page"><EmptyState title="插件页面暂时无法显示" description={this.state.error} /></div> : this.props.children; }
}
export default function PluginPage({ plugin }: { plugin: PluginInfo }) {
  const [Page, setPage] = useState<React.ComponentType | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true; setPage(null); setError("");
    let stylesheet: HTMLLinkElement | undefined;
    if (plugin.styleURL) { stylesheet = document.createElement("link"); stylesheet.rel = "stylesheet"; stylesheet.href = plugin.styleURL; document.head.append(stylesheet); }
    void import(/* @vite-ignore */ plugin.clientURL).then(module => {
      if (typeof module.default !== "function") throw new Error("插件没有导出页面组件");
      if (live) setPage(() => module.default);
    }).catch(e => live && setError(String(e)));
    return () => { live = false; stylesheet?.remove(); };
  }, [plugin.clientURL, plugin.styleURL]);
  return <Boundary>{error ? <div className="m-page"><EmptyState title="插件页面加载失败" description={error} /></div> : Page ? <Page /> : <div className="loading-state"><span className="loader" />正在打开 {plugin.name}…</div>}</Boundary>;
}
