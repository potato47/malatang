// Open /tests/keep-alive.html on the running FIA development URL.
// This exercises real DOM, React effects, dynamic modules and stylesheet media.
import React, { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PluginInfo } from "../../packages/sdk/src/types";
import PageSlot from "../PageSlot";
import PluginPage, { pluginPageKey } from "../PluginPage";
import "../style.css";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, __MALATANG_MODULES__: { react: React } });
const container = document.getElementById("fixture")!;
container.style.cssText = "height:180px;width:420px;display:flex;flex-direction:column";
const root = createRoot(container);
const results: string[] = [];
let mounts = 0;
let cleanups = 0;
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function Draft() {
  const [value, setValue] = useState("");
  useEffect(() => { mounts++; return () => { cleanups++; }; }, []);
  return <div style={{ minHeight: 800, minWidth: 700 }}>
    <input aria-label="Draft" value={value} readOnly /><button onClick={() => setValue("unsaved draft")}>Edit</button>
  </div>;
}
async function render(visible: boolean, keepAlive: boolean, identity = "page", exists = true) {
  await act(async () => { root.render(exists ? <PageSlot key={identity} visible={visible} keepAlive={keepAlive} label="Fixture"><Draft /></PageSlot> : null); });
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for plugin");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  }
}

async function run() {
  await render(false, true);
  assert(mounts === 0 && !container.querySelector("section"), "Hidden unvisited page must not mount");
  await render(true, true);
  await act(async () => { container.querySelector("button")!.click(); });
  const slot = container.querySelector<HTMLElement>("section")!;
  const input = container.querySelector<HTMLInputElement>("input")!;
  slot.scrollTop = 140; slot.scrollLeft = 60;
  await render(false, true);
  assert(slot.hidden && slot.inert && slot.getAttribute("aria-hidden") === "true", "Hidden page must be inert and inaccessible");
  input.focus();
  assert(document.activeElement !== input, "Hidden page must reject focus");
  assert(Number(cleanups) === 0, "Retained page effects must remain alive");
  await render(true, true);
  assert(container.querySelector("input") === input && input.value === "unsaved draft", "Retain component and DOM state");
  assert(slot.scrollTop === 140 && slot.scrollLeft === 60, "Restore both scroll axes");
  await render(true, true);
  assert(Number(mounts) === 1, "Ordinary rerender must not remount");
  results.push("PASS lazy mount, draft, DOM identity, scroll, effects and hidden focus");

  await render(false, false);
  assert(Number(cleanups) === 1 && !container.querySelector("input"), "Non-retained page must release DOM and effects");
  await render(true, false);
  assert(container.querySelector<HTMLInputElement>("input")!.value === "", "Non-retained page must initialize again");
  await render(true, true, "new-resource");
  assert(Number(cleanups) === 2 && Number(mounts) === 3, "Resource change must replace the instance");
  await render(false, true, "new-resource", false);
  assert(Number(cleanups) === 3 && !container.querySelector("section"), "Removal must release retained page");
  await render(true, true, "new-resource");
  assert(Number(mounts) === 4, "Re-enable must create a fresh instance");
  results.push("PASS opt-out, resource change, removal and re-enable cleanup");

  const module = "const React=globalThis.__MALATANG_MODULES__.react; export default function Page(){return React.createElement('input',{'aria-label':'Loaded plugin',defaultValue:'initial'});}";
  const url = URL.createObjectURL(new Blob([module], { type: "text/javascript" }));
  const nextURL = URL.createObjectURL(new Blob([module], { type: "text/javascript" }));
  const styleURL = URL.createObjectURL(new Blob([":root{--retention-test:active}"], { type: "text/css" }));
  const plugin: PluginInfo = { id: "fixture", version: "1", clientURL: url, styleURL, keepAlive: true, name: "Fixture", description: "", icon: "F", color: "#000000", packageName: "fixture", source: "test", builtin: false, enabled: true, status: "active", error: null, methods: [] };
  const show = async (info: PluginInfo, visible: boolean) => {
    await act(async () => { root.render(<PageSlot key={pluginPageKey(info)} visible={visible} keepAlive={info.keepAlive} label={info.name}><PluginPage plugin={info} visible={visible} /></PageSlot>); });
  };
  try {
    await show(plugin, true);
    await until(() => Boolean(container.querySelector('[aria-label="Loaded plugin"]')) && getComputedStyle(document.documentElement).getPropertyValue("--retention-test") === "active");
    const draft = container.querySelector<HTMLInputElement>("input")!;
    draft.value = "plugin draft";
    const link = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].find(link => link.href === styleURL)!;
    await show({ ...plugin }, false);
    assert(link.media === "not all" && getComputedStyle(document.documentElement).getPropertyValue("--retention-test") === "", "Hidden plugin stylesheet must not affect other pages");
    await show({ ...plugin }, true);
    assert(container.querySelector("input") === draft && draft.value === "plugin draft" && String(link.media) === "all", "List refresh and reactivation must reuse plugin and stylesheet");
    await show({ ...plugin, clientURL: nextURL }, true);
    await until(() => Boolean(container.querySelector('[aria-label="Loaded plugin"]')));
    assert(container.querySelector("input") !== draft && !link.isConnected, "Same-version replacement must discard old page and link");
    await act(async () => { root.render(null); });
    assert(![...document.querySelectorAll<HTMLLinkElement>("link")].some(link => link.href === styleURL), "Disposal must remove plugin stylesheet");
    results.push("PASS dynamic plugin reuse, stylesheet activation and same-version replacement");
  } finally {
    await act(async () => { root.unmount(); });
    for (const resource of [url, nextURL, styleURL]) URL.revokeObjectURL(resource);
  }
  document.getElementById("results")!.textContent = results.join("\n");
  document.documentElement.dataset.result = "pass";
}
void run().catch(error => {
  document.getElementById("results")!.textContent = [...results, String(error)].join("\n");
  document.documentElement.dataset.result = "fail";
  console.error(error);
});
