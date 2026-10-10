import React, { useMemo, useState } from "react";
import { Alert, Button } from "./ui/basic";
import {
  Combobox,
  ComboboxTrigger,
  ComboboxContent,
  ComboboxInput,
  ComboboxList,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxItem,
  ComboboxEmpty,
} from "./ui/selection";
import { ChevronDown } from "lucide-react";
import type { HostBridge, ModelInfo } from "./types";
export function ModelSelect({
  models,
  value,
  onValueChange,
  disabled,
  "aria-label": label = "选择模型",
}: {
  models: ModelInfo[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const selected = models.find((model) => model.id === value);
  const groups = useMemo(() => {
    const groups = new Map<string, ModelInfo[]>();
    for (const model of models) {
      if (
        !`${model.name} ${model.provider} ${model.id}`.toLowerCase().includes(query.toLowerCase())
      )
        continue;
      const key = model.provider;
      groups.set(key, [...(groups.get(key) ?? []), model]);
    }
    return [...groups];
  }, [models, query]);
  const manage = () => {
    const bridge = (globalThis as typeof globalThis & { __MALATANG_BRIDGE__?: HostBridge })
      .__MALATANG_BRIDGE__;
    void bridge?.call("chatgpt.manageUsage", {}).catch(() => setError("无法打开 ChatGPT 用量设置"));
  };
  return (
    <div className="m-model-picker">
      <Combobox<string>
        value={value || null}
        onValueChange={(next) => next && onValueChange(next)}
        disabled={disabled || !models.some((model) => model.configured)}
        items={models.map((model) => model.id)}
        filteredItems={groups.flatMap(([, items]) => items.map((model) => model.id))}
        filter={null}
        inputValue={query}
        onInputValueChange={(next, details) => {
          if (details.reason === "input-change" || details.reason === "input-clear") setQuery(next);
        }}
        onOpenChange={(open) => {
          if (!open) setQuery("");
        }}
      >
        <ComboboxTrigger aria-label={label}>
          {selected?.name ?? (models.length ? "选择可用模型" : "请先在设置中添加模型")}
          <ChevronDown size={16} />
        </ComboboxTrigger>
        <ComboboxContent>
          <ComboboxInput aria-label="搜索模型" placeholder="搜索模型或服务商" />
          <ComboboxEmpty>没有匹配的模型</ComboboxEmpty>
          <ComboboxList>
            {groups.map(([provider, items]) => (
              <ComboboxGroup key={provider}>
                <ComboboxGroupLabel>{provider}</ComboboxGroupLabel>
                {items.map((model) => (
                  <ComboboxItem key={model.id} value={model.id} disabled={!model.configured}>
                    {model.name}
                    {!model.configured && " · 需配置"}
                  </ComboboxItem>
                ))}
              </ComboboxGroup>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {selected?.kind === "chatgpt" && (
        <small>
          Using ChatGPT plan{" "}
          <Button variant="ghost" size="sm" onClick={manage}>
            管理用量 ↗
          </Button>
        </small>
      )}
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
