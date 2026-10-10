import React, { useEffect, useState } from "react";
import {
  Alert,
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogClose,
  Badge,
  Button,
  IconButton,
  Input,
  Page,
  PageHeader,
  Panel,
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MoreHorizontal,
  Download,
  Trash2,
  Package,
  Loading,
} from "@semicoder/malatang-sdk/ui";
import type { InstallJob, PluginInfo } from "@semicoder/malatang-sdk/types";
import { app } from "./bridge";
import { native } from "@semicoder/fia/client";
export default function PluginManager({
  plugins,
  open,
}: {
  plugins: PluginInfo[];
  open: (id: string) => void;
}) {
  const [source, setSource] = useState("");
  const [jobs, setJobs] = useState<InstallJob[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState<PluginInfo | null>(null);
  const refresh = () =>
    app
      .call("plugins.jobs", {})
      .then(setJobs)
      .catch((e) => setError(String(e)));
  useEffect(() => {
    const off = app.on("plugins.changed", () => void refresh());
    const reconnect = app.onReconnect(() => void refresh());
    void refresh();
    return () => {
      off();
      reconnect();
    };
  }, []);
  const act = async (action: () => Promise<unknown>) => {
    setPending(true);
    setError("");
    try {
      await action();
      await refresh();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setPending(false);
    }
  };
  const installing = pending || jobs.some((job) => job.status === "installing");
  return (
    <Page>
      <PageHeader
        title="应用中心"
        description="安装和管理你的应用。"
        actions={<Badge>{plugins.length} 个已安装</Badge>}
      />
      <Panel className="install-panel">
        <div className="flex items-center gap-2">
          <Download size={18} />
          <h2>安装应用</h2>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void act(() => app.call("plugins.install", { source }));
          }}
          className="install-form"
        >
          <Input
            aria-label="插件安装来源"
            required
            placeholder="npm 包名、Git 地址或本地归档路径"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <Button
            variant="secondary"
            disabled={installing}
            onClick={() =>
              void native.dialogs
                .openFiles({ multiple: false })
                .then((paths) => {
                  if (paths?.[0]) setSource(paths[0]);
                })
                .catch((e) => setError(String(e)))
            }
          >
            选择文件
          </Button>
          <Button disabled={installing || !source.trim()} type="submit">
            安装
          </Button>
        </form>
        <p className="install-note">插件可执行本机代码，请只安装可信来源。</p>
      </Panel>
      {error && <Alert>{error}</Alert>}
      {jobs.slice(0, 2).map((job) => (
        <div className={`job-row ${job.status}`} role="status" key={job.id}>
          {job.status === "installing" && <Loading />}
          <div>
            <strong>{job.message}</strong>
            <small>{job.source}</small>
          </div>
        </div>
      ))}
      <div className="section-title">
        <h2>已安装</h2>
      </div>
      <div className="plugin-list">
        {plugins.map((plugin) => (
          <div key={plugin.id} className="plugin-row">
            <span className="app-icon" style={{ background: plugin.color }}>
              {plugin.icon}
            </span>
            <div className="plugin-row-info">
              <div className="flex flex-wrap items-center gap-2">
                <h3>{plugin.name}</h3>
                <Badge tone={plugin.status === "error" ? "error" : "neutral"}>
                  {plugin.status === "active"
                    ? plugin.builtin
                      ? "内置"
                      : "已启用"
                    : plugin.status === "error"
                      ? "加载失败"
                      : "已停用"}
                </Badge>
              </div>
              <p>{plugin.description}</p>
              <small>v{plugin.version}</small>
              {plugin.error && <Alert>{plugin.error}</Alert>}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={plugin.status !== "active"}
                onClick={() => open(plugin.id)}
              >
                打开
              </Button>
              <Menu>
                <MenuTrigger
                  render={
                    <IconButton
                      id={`plugin-actions-${plugin.id}`}
                      label={`${plugin.name} 更多操作`}
                      variant="ghost"
                      disabled={pending}
                    >
                      <MoreHorizontal />
                    </IconButton>
                  }
                />
                <MenuContent align="end">
                  <MenuItem
                    disabled={pending}
                    onClick={() =>
                      void act(() =>
                        app.call("plugins.setEnabled", {
                          pluginId: plugin.id,
                          enabled: !plugin.enabled,
                        }),
                      )
                    }
                  >
                    {plugin.enabled ? "停用" : "启用"}
                  </MenuItem>
                  {!plugin.builtin && (
                    <MenuItem onClick={() => setRemoving(plugin)}>
                      <Trash2 size={16} />
                      卸载
                    </MenuItem>
                  )}
                </MenuContent>
              </Menu>
            </div>
          </div>
        ))}
      </div>
      {!plugins.some((plugin) => plugin.id === "quick-notes") && (
        <Panel className="example-install">
          <Package size={24} />
          <div className="flex-1">
            <h3>随手记</h3>
            <p>记录想法并保存到本机，无需配置模型。</p>
          </div>
          <Button
            variant="secondary"
            disabled={installing}
            onClick={() => void act(() => app.call("plugins.installExample", {}))}
          >
            安装示例
          </Button>
        </Panel>
      )}
      <AlertDialog
        open={!!removing}
        onOpenChange={(value) => {
          if (!value && !pending) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>卸载 {removing?.name}？</AlertDialogTitle>
          <AlertDialogDescription>
            插件将从应用列表中移除，KV 数据和历史记录会保留。
          </AlertDialogDescription>
          {error && <Alert>{error}</Alert>}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="secondary" disabled={pending} />}>
              取消
            </AlertDialogClose>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => {
                if (removing)
                  void act(() => app.call("plugins.uninstall", { pluginId: removing.id })).then(
                    (ok) => {
                      if (ok) setRemoving(null);
                    },
                  );
              }}
            >
              卸载
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
