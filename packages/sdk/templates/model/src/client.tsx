import "./styles.css";
import icon from "./assets/notebook.svg";
import React, { useEffect, useRef, useState } from "react";
import { createPluginClient } from "@semicoder/malatang-sdk/client";
import type { ModelInfo, ModelRun } from "@semicoder/malatang-sdk/types";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Loading,
  ModelSelect,
  Page,
  PageHeader,
  Panel,
  PanelHeader,
  PanelContent,
  PanelFooter,
  Textarea,
} from "@semicoder/malatang-sdk/ui";
import styles from "./page.module.css";
const client = createPluginClient("__PLUGIN_ID__");
export default function ModelPage() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [run, setRun] = useState<ModelRun | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const selectedRun = useRef("");
  const alive = useRef(false);
  useEffect(() => {
    let live = true;
    alive.current = true;
    let generation = 0;
    const refreshModels = async () => {
      const current = ++generation;
      try {
        const items = await client.models.list();
        if (live && current === generation) {
          setModels(items);
          setModelId((value) =>
            items.some((item) => item.id === value && item.configured)
              ? value
              : (items.find((item) => item.configured)?.id ?? ""),
          );
        }
      } catch (error) {
        if (live) setError(String(error));
      } finally {
        if (live) setLoading(false);
      }
    };
    const refreshRun = async () => {
      const id = selectedRun.current;
      if (!id) return;
      try {
        const next = await client.runs.get(id);
        if (live && selectedRun.current === id)
          setRun((previous) => (!previous || next.revision >= previous.revision ? next : previous));
      } catch (error) {
        if (live) setError(String(error));
      }
    };
    // Subscribe before the first request; reconnect rereads authoritative state.
    const offModels = client.models.onChange(() => void refreshModels());
    const offRuns = client.runs.onChange(() => void refreshRun());
    const offReconnect = client.onReconnect(() => {
      void refreshModels();
      void refreshRun();
    });
    void refreshModels();
    return () => {
      live = false;
      alive.current = false;
      offModels();
      offRuns();
      offReconnect();
    };
  }, []);
  const start = async () => {
    setPending(true);
    setError("");
    setRun(null);
    selectedRun.current = "";
    try {
      const next = await client.models.start({ modelId, prompt, title: prompt.slice(0, 60) });
      selectedRun.current = next.id;
      const latest = await client.runs.get(next.id);
      if (alive.current) setRun(latest);
    } catch (error) {
      if (alive.current) setError(String(error));
    } finally {
      if (alive.current) setPending(false);
    }
  };
  const cancel = async () => {
    if (!run) return;
    setPending(true);
    try {
      const next = await client.runs.cancel(run.id);
      if (alive.current)
        setRun((previous) => (!previous || next.revision >= previous.revision ? next : previous));
    } catch (error) {
      if (alive.current) setError(String(error));
    } finally {
      if (alive.current) setPending(false);
    }
  };
  const busy = pending || run?.status === "running";
  const available = models.some((model) => model.configured);
  return (
    <Page className="p:space-y-6">
      <PageHeader
        title={__PLUGIN_NAME_JSON__}
        description="使用宿主模型，查看流式输出并随时取消。"
      />
      {loading ? (
        <Loading label="读取模型" />
      ) : (
        !available && (
          <EmptyState title="尚无可用模型" description="请先在设置 → 模型服务中添加并连接模型。" />
        )
      )}
      <Panel>
        <PanelHeader>
          <span className={styles.heading}>
            <img className={styles.logo} src={new URL(icon, import.meta.url).href} alt="" />
            模型请求
          </span>
          {run && (
            <Badge
              tone={
                run.status === "failed"
                  ? "error"
                  : run.status === "completed"
                    ? "success"
                    : "neutral"
              }
            >
              {run.status}
            </Badge>
          )}
        </PanelHeader>
        <PanelContent>
          <Field label="模型">
            <ModelSelect
              models={models}
              value={modelId}
              disabled={busy}
              onValueChange={(value) => setModelId(value ?? "")}
            />
          </Field>
          <Field label="提示词">
            <Textarea
              value={prompt}
              disabled={busy}
              maxLength={16000}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="希望模型帮你做什么？"
            />
          </Field>
          <div className={styles.output} aria-live="polite" aria-label="模型输出">
            {run?.output || (busy ? "正在等待输出…" : "生成结果会显示在这里。")}
          </div>
        </PanelContent>
        <PanelFooter>
          <span>{run?.status === "cancelled" ? "已取消" : "使用宿主统一模型配置"}</span>
          {run?.status === "running" ? (
            <Button variant="secondary" loading={pending} onClick={() => void cancel()}>
              停止生成
            </Button>
          ) : (
            <Button
              loading={pending}
              disabled={!available || !modelId || !prompt.trim()}
              onClick={() => void start()}
            >
              开始生成
            </Button>
          )}
        </PanelFooter>
      </Panel>
      {(error || run?.error) && <Alert>{error || run?.error}</Alert>}
    </Page>
  );
}
