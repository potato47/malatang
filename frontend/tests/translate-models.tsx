import { UIProvider } from "@semicoder/malatang-sdk/ui";
import "../tailwind.css";
// Runs only on FIA's development server, with no real account or model calls.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { HostBridge, ModelInfo, ModelRun } from "@semicoder/malatang-sdk/types";
import "../style.css";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let models: ModelInfo[] = [];
const legacy: ModelRun = {
  id: "legacy",
  pluginId: "translate",
  modelId: "demo",
  input: "legacy input",
  output: "legacy output",
  title: "legacy",
  demo: true,
  status: "completed",
  error: null,
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
};
let runs = [legacy];
const calls: { method: string; input: any }[] = [];
const listeners = new Map<string, (payload: unknown) => void>();
const bridge: HostBridge = {
  async call(method, input) {
    if (method === "models.list") return structuredClone(models);
    if (method === "kv.get") return { modelId: "demo", target: "简体中文" };
    if (method === "runs.list") return structuredClone(runs);
    if (method === "runs.get")
      return structuredClone(runs.find((run) => run.id === (input as { runId: string }).runId));
    if (method === "plugins.invoke") {
      calls.push({ method, input });
      const params = input as { input: { modelId: string; text: string } };
      const run = {
        ...legacy,
        id: "real-model-run",
        modelId: params.input.modelId,
        input: params.input.text,
        output: "fixture result",
        demo: false,
      };
      runs = [run, legacy];
      return structuredClone(run);
    }
    throw new Error("Unexpected fixture call: " + method);
  },
  on(event, listener) {
    listeners.set(event, listener);
    return () => {
      listeners.delete(event);
    };
  },
  onReconnect: () => () => {},
};
Object.assign(globalThis, { __MALATANG_BRIDGE__: bridge });
const { default: Translate } = await import("../../plugins/translate/src/client");
const root = createRoot(document.getElementById("fixture")!);
const results: string[] = [];
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
const select = () => document.querySelector<HTMLButtonElement>('[aria-label="翻译模型"]')!;
const button = () =>
  [...document.querySelectorAll("button")].find((item) =>
    item.textContent?.startsWith("开始翻译"),
  )!;
async function publish(items: ModelInfo[]) {
  models = items;
  await act(async () => {
    listeners.get("models.changed")?.({});
  });
}
async function run() {
  await act(async () => {
    root.render(
      <UIProvider>
        <Translate />
      </UIProvider>,
    );
  });
  assert(
    select().disabled && button().disabled,
    "Empty model list must disable model selection and generation",
  );
  assert(!select().textContent?.includes("demo"), "Removed model must not appear in the selector");
  assert(
    !document.querySelector('[aria-label="翻译结果"]')!.textContent?.includes("legacy output"),
    "Old demo output must not automatically become the current result",
  );
  await act(async () => {
    document
      .querySelector("textarea")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
  });
  assert(calls.length === 0, "Keyboard shortcut must not generate without a model");
  results.push("PASS empty list, obsolete saved preference, legacy history and keyboard guard");

  const model: ModelInfo = {
    id: "configured-model",
    name: "Account model",
    provider: "ChatGPT",
    model: "account-model",
    baseURL: "https://api.openai.com/v1",
    kind: "chatgpt",
    configured: true,
    preset: null,
    hasApiKey: false,
    options: {},
  };
  await publish([{ ...model, id: "unconfigured", configured: false }, model]);
  assert(
    select().textContent?.includes(model.name) && !button().disabled,
    "Adding a connected model must replace obsolete preference and enable generation",
  );
  await act(async () => {
    document
      .querySelector("textarea")!
      .dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          isComposing: true,
          bubbles: true,
        }),
      );
  });
  assert(calls.length === 0, "IME composition must not submit even when a model is available");
  await act(async () => {
    select().click();
  });
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const options = [...document.querySelectorAll('[role="option"]')];
  assert(
    options.length === 2 && options.some((item) => item.hasAttribute("data-disabled")),
    "Model search must list configured and unavailable models",
  );
  const search = document.querySelector<HTMLInputElement>('[aria-label="搜索模型"]')!;
  assert(search.value === "", "Opening model search must not filter by the selected model ID");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      search,
      "no-match",
    );
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert(
    !document.querySelector('[role="option"]') &&
      document.body.textContent?.includes("没有匹配的模型"),
    "Search must show its empty state",
  );
  await act(async () => {
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  results.push("PASS grouped model search, unavailable entries and empty state");
  await act(async () => {
    button().click();
  });
  assert(
    calls[0]?.input.pluginId === "translate" && calls[0]?.input.input.modelId === model.id,
    "Plugin must submit the configured host model ID",
  );
  assert(
    document.querySelector('[aria-label="翻译结果"]')!.textContent === "fixture result",
    "Plugin must display the host model result",
  );
  results.push("PASS connected model discovery, SDK invocation and result rendering");

  await publish([{ ...model, configured: false }]);
  assert(
    select().disabled && button().disabled,
    "Losing account authorization must disable generation",
  );
  await publish([]);
  assert(
    select().textContent?.includes("请先在设置中添加模型") && button().disabled,
    "Removing the last model must clear selection",
  );
  results.push("PASS account disconnection and removal of the last model");

  const removed: ModelInfo = {
    ...model,
    id: "removed-preset",
    kind: "pi",
    provider: "Together",
    preset: "together",
    model: "google/gemma-4-31B-it",
    configured: false,
    hasApiKey: true,
  };
  await publish([removed]);
  assert(
    select().disabled && button().disabled,
    "A removed Pi model must stay disabled even with saved credentials",
  );

  const previousCalls = calls.length;
  await act(async () => {
    document
      .querySelector("textarea")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
  });
  assert(
    calls.length === previousCalls,
    "Keyboard shortcut must not generate with a removed catalog entry",
  );
  await publish([{ ...removed, model: "deepseek-ai/DeepSeek-V4-Pro-0813", configured: true }]);
  assert(
    select().textContent?.includes(removed.name) && !button().disabled,
    "Repairing a preset must restore selection using the same host ID",
  );
  results.push("PASS removed Pi preset, keyboard guard and repaired configuration");
  await act(async () => {
    root.unmount();
  });
  document.getElementById("results")!.textContent = results.join("\n");
  document.documentElement.dataset.result = "pass";
}
void run().catch((error) => {
  document.getElementById("results")!.textContent = [...results, String(error)].join("\n");
  document.documentElement.dataset.result = "fail";
  console.error(error);
});
