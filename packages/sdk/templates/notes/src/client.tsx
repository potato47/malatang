import "./styles.css";
import icon from "./assets/notebook.svg";
import React, { useEffect, useRef, useState } from "react";
import { createPluginClient } from "@semicoder/malatang-sdk/client";
import {
  Alert,
  Badge,
  Button,
  Field,
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
export default function Notes() {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    let current = true;
    void client.kv
      .get("note")
      .then((value) => {
        if (current) {
          const content = typeof value === "string" ? value : "";
          setText(content);
          setSaved(content);
        }
      })
      .catch((error) => current && setError(String(error)))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
      alive.current = false;
    };
  }, []);
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await client.kv.set("note", text);
      if (alive.current) setSaved(text);
    } catch (error) {
      if (alive.current) setError(String(error));
    } finally {
      if (alive.current) setSaving(false);
    }
  };
  return (
    <Page className="p:space-y-6">
      <PageHeader title={__PLUGIN_NAME_JSON__} description="记录想法，保存在本机。" />
      <Panel>
        <PanelHeader>
          <span className={styles.heading}>
            <img className={styles.logo} src={new URL(icon, import.meta.url).href} alt="" />
            随手记
          </span>
          <Badge>{loading ? "读取中" : saved === text ? "已保存" : "尚未保存"}</Badge>
        </PanelHeader>
        <PanelContent>
          <Field label="笔记内容" hint="手动保存；离开页面会保留当前草稿。">
            <Textarea
              className={styles.editor}
              value={text}
              maxLength={16000}
              disabled={loading || saving}
              onChange={(event) => setText(event.target.value)}
              placeholder="从一个想法开始…"
            />
          </Field>
        </PanelContent>
        <PanelFooter>
          <span>{text.length} / 16,000</span>
          <Button loading={saving} disabled={loading || saved === text} onClick={() => void save()}>
            保存笔记
          </Button>
        </PanelFooter>
      </Panel>
      {error && <Alert>{error}</Alert>}
    </Page>
  );
}
