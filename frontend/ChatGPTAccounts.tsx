import React, { useState } from "react";
import { Button, Field, Input } from "@semicoder/malatang-sdk/ui";
import { chatGPTLabel, type ChatGPTStatus } from "../shared/chatgpt";
import { app } from "./bridge";

export default function ChatGPTAccounts({
  status,
  busy,
  perform,
}: {
  status: ChatGPTStatus;
  busy: boolean;
  perform(action: () => Promise<unknown>): Promise<boolean>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [removing, setRemoving] = useState<string[]>([]);
  const waiting = status.attempt?.stage === "waiting" || status.attempt?.stage === "exchanging";
  const disabled = busy || waiting || !status.available;
  const incomplete = status.profiles.filter((p) => p.incomplete && !p.removalBlockedReason);
  const selected = status.profiles.filter((p) => removing.includes(p.id));
  return (
    <details className="chatgpt-accounts">
      <summary>管理账号 · {status.profiles.length}</summary>
      <div className="chatgpt-accounts-heading">
        <p>修改显示名称，或移除不再使用的本地记录。</p>
        <Button
          variant="secondary"
          disabled={disabled || !incomplete.length}
          onClick={() => {
            setEditing(null);
            setRemoving(incomplete.map((p) => p.id));
          }}
        >
          清理未完成登录{incomplete.length ? `（${incomplete.length}）` : ""}
        </Button>
      </div>
      <ul className="chatgpt-account-list">
        {status.profiles.map((p) => (
          <li key={p.id}>
            <div className="chatgpt-account-row">
              <div className="chatgpt-account-label">
                <strong>{p.label}</strong>
                <small>
                  {p.email ? `${p.email} · ` : ""}
                  {p.connected ? "已登录" : p.incomplete ? "未完成登录" : "已退出登录"}
                  {p.id === status.activeProfileId ? " · 当前账号" : ""}
                </small>
              </div>
              <div className="chatgpt-actions">
                <Button
                  variant="ghost"
                  aria-label={`重命名 ${p.label}`}
                  disabled={disabled}
                  onClick={() => {
                    setRemoving([]);
                    setEditing(p.id);
                    setLabel(p.label);
                  }}
                >
                  重命名
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`移除 ${p.label}`}
                  title={p.removalBlockedReason ?? undefined}
                  disabled={disabled || Boolean(p.removalBlockedReason)}
                  onClick={() => {
                    setEditing(null);
                    setRemoving([p.id]);
                  }}
                >
                  移除
                </Button>
              </div>
            </div>
            {p.removalBlockedReason && (
              <p className="chatgpt-account-hint">{p.removalBlockedReason}</p>
            )}
            {editing === p.id && (
              <form
                className="chatgpt-account-edit"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!disabled && chatGPTLabel.safeParse(label).success)
                    void perform(() => app.call("chatgpt.rename", { profileId: p.id, label })).then(
                      (ok) => {
                        if (ok) setEditing(null);
                      },
                    );
                }}
              >
                <Field label="账号名称" hint="仅修改显示名称，不改变登录身份或模型绑定。">
                  <Input
                    aria-label="账号名称"
                    autoFocus
                    value={label}
                    maxLength={100}
                    disabled={disabled}
                    onChange={(event) => setLabel(event.target.value)}
                  />
                </Field>
                <div className="chatgpt-actions">
                  <Button
                    type="submit"
                    disabled={disabled || !chatGPTLabel.safeParse(label).success}
                  >
                    保存名称
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setEditing(null)}
                  >
                    取消修改
                  </Button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
      {selected.length > 0 && (
        <div className="chatgpt-account-confirm" role="group" aria-label="确认移除账号">
          <strong>移除 {selected.length} 个本地账号记录？</strong>
          <p>{selected.map((p) => p.label).join("、")}</p>
          <p>
            移除后，再次登录需要添加账号。此操作不会注销你的 ChatGPT 账号，也不会撤销远程应用授权。
          </p>
          <div className="chatgpt-actions">
            <Button
              variant="danger"
              disabled={
                disabled ||
                selected.length !== removing.length ||
                selected.some((p) => p.removalBlockedReason)
              }
              onClick={() =>
                void perform(() => app.call("chatgpt.remove", { profileIds: removing })).then(
                  (ok) => {
                    if (ok) setRemoving([]);
                  },
                )
              }
            >
              确认移除
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setRemoving([])}>
              取消移除
            </Button>
          </div>
        </div>
      )}
    </details>
  );
}
