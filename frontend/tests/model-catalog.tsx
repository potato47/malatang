import { UIProvider } from "@semicoder/malatang-sdk/ui";
import "../tailwind.css";
// Run on FIA's development server; configuration and credentials are fixtures.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { ModelInfo, PresetModel, ProviderPreset } from "@semicoder/malatang-sdk/types";
import ModelSettings from "../ModelSettings";
import { app } from "../bridge";
import "../style.css";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
app.close();
const removed: ModelInfo = {
  id: "saved-model",
  name: "我的模型",
  kind: "pi",
  provider: "Together",
  preset: "together",
  model: "google/gemma-4-31B-it",
  baseURL: "https://proxy.example.test/v1",
  options: {},
  hasApiKey: true,
  configured: false,
};
const provider: ProviderPreset = {
  id: "together",
  name: "Together",
  modelCount: 1,
  apiKeySupported: true,
  keyLabel: "API Key",
  fields: [],
  notice: "",
};
const replacement: PresetModel = {
  id: "deepseek-ai/DeepSeek-V4-Pro-0813",
  name: "DeepSeek",
  api: "openai-completions",
  baseURL: "https://api.together.xyz/v1",
  contextWindow: 1048576,
  reasoning: true,
};
let models = [removed];
let failCatalog = false;
let saved: Record<string, unknown> | undefined;
Object.assign(app, {
  call: async (method: string, input: Record<string, unknown>) => {
    if (method === "models.list") return structuredClone(models);
    if (method === "models.providers") return [provider];
    if (method === "chatgpt.status")
      return { available: false, activeProfileId: null, profiles: [], attempt: null, message: "" };
    if (method === "models.catalog") {
      if (failCatalog) throw new Error("目录读取失败");
      return [replacement];
    }
    if (method === "models.save") {
      saved = structuredClone(input);
      models = [{ ...removed, model: String(input.model), configured: true }];
      return models[0];
    }
    throw new Error("Unexpected fixture call: " + method);
  },
  on: () => () => {},
  onReconnect: () => () => {},
});
const root = createRoot(document.getElementById("fixture")!);
let generation = 0;
const results: string[] = [];
function activateOption(node: HTMLElement) {
  node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
  node.click();
}
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((item) => item.textContent === text)!;
const select = () => document.querySelector<HTMLButtonElement>('[aria-label="预设模型"]')!;
async function render() {
  models = [removed];
  await act(async () => {
    root.render(
      <UIProvider>
        <ModelSettings key={++generation} />
      </UIProvider>,
    );
  });
}
async function edit() {
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[aria-label="编辑 我的模型"]')!.click();
  });
}
async function run() {
  await render();
  assert(
    document.querySelector(".configured-model")?.textContent?.includes("需重新选择模型"),
    "Saved credentials must not make a removed model appear configured",
  );
  await edit();
  assert(
    select().textContent?.includes(removed.model),
    "The unavailable saved ID must stay visible without selecting a replacement",
  );
  assert(button("保存模型").disabled, "Cannot save a model missing from the catalog");
  assert(
    document.querySelector('[role="status"]')?.textContent?.includes("原配置已保留"),
    "Explain that the saved configuration is retained",
  );
  assert(
    document.querySelector<HTMLInputElement>('[aria-label="API Key"]')!.value === "",
    "Never render the stored credential",
  );
  results.push("PASS unavailable badge, retained selection, disabled save and credential privacy");

  await act(async () => {
    select().click();
  });
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert(
    [...document.querySelectorAll('[role="option"]')]
      .find((node) => node.textContent?.includes(removed.model))
      ?.hasAttribute("data-disabled"),
    "Unavailable item cannot be selected",
  );
  await act(async () => {
    activateOption(
      [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) =>
        node.textContent?.includes(replacement.id),
      )!,
    );
  });
  assert(
    !button("保存模型").disabled && !document.querySelector('[role="status"]'),
    "An explicit current selection must clear the unavailable warning",
  );
  await act(async () => {
    button("保存模型").click();
  });
  assert(
    saved?.id === removed.id && saved?.model === replacement.id,
    "Repair must target the existing host model identity",
  );
  assert(
    saved?.apiKey === "" && saved?.baseURL === removed.baseURL && saved?.preset === removed.preset,
    "Repair must preserve the connection and request retention of the saved key",
  );
  assert(
    document.querySelector(".configured-model")?.textContent?.includes("已配置"),
    "Successful repair must refresh the model list",
  );
  results.push("PASS explicit repair, stable host ID, retained endpoint/key and refreshed status");

  failCatalog = true;
  await render();
  await edit();
  assert(
    document.querySelector('[role="alert"]')?.textContent?.includes("目录读取失败"),
    "Catalog fetch failure must be reported",
  );
  assert(
    !document.querySelector('[role="status"]') && button("保存模型").disabled,
    "A failed catalog fetch must not claim the model was removed or allow saving",
  );
  results.push("PASS catalog read failure remains distinct from a removed model");
  if (new URL(location.href).searchParams.has("preview")) {
    failCatalog = false;
    await render();
    await edit();
  } else
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
