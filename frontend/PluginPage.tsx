import React, { Component, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PluginInfo } from "@semicoder/malatang-sdk/types";
import { EmptyState } from "@semicoder/malatang-sdk/ui";
class Boundary extends Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() { return this.state.error ? <div className="m-page"><EmptyState title="插件页面暂时无法显示" description={this.state.error} /></div> : this.props.children; }
}
export const pluginPageKey = (plugin: PluginInfo) => JSON.stringify([plugin.id, plugin.version, plugin.clientURL, plugin.styleURL, plugin.keepAlive]);

export default function PluginPage({ plugin, visible }: { plugin: PluginInfo; visible: boolean }) {
  const [Page, setPage] = useState<React.ComponentType | null>(null);
  const [error, setError] = useState("");
  const stylesheet = useRef<HTMLLinkElement | null>(null);
  useLayoutEffect(() => {
    if (!plugin.styleURL) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = plugin.styleURL;
    link.media = "not all";
    stylesheet.current = link;
    document.head.append(link);
    return () => { link.remove(); stylesheet.current = null; };
  }, [plugin.styleURL]);
  useLayoutEffect(() => {
    if (stylesheet.current) stylesheet.current.media = visible ? "all" : "not all";
  }, [visible, plugin.styleURL]);
  useEffect(() => {
    let live = true; setPage(null); setError("");
    void import(/* @vite-ignore */ plugin.clientURL).then(module => {
      if (typeof module.default !== "function") throw new Error("插件没有导出页面组件");
      if (live) setPage(() => module.default);
    }).catch(e => live && setError(String(e)));
    return () => { live = false; };
  }, [plugin.clientURL]);
  return <Boundary>{error ? <div className="m-page"><EmptyState title="插件页面加载失败" description={error} /></div> : Page ? <Page /> : <div className="loading-state"><span className="loader" />正在打开 {plugin.name}…</div>}</Boundary>;
}
