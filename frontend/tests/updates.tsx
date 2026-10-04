import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { native, type UpdateState } from "@semicoder/fia/client";
import UpdateSettings from "../UpdateSettings";
import "../style.css";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let state: UpdateState = { phase: "idle" }, busy = false, calls: string[] = [], generation = 0;
const listeners = new Set<() => void>();
Object.assign(native, {
  on: (_: string, listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
});
Object.assign(native.application, { info: async () => ({ name: "Malatang", identifier: "com.semicoder.malatang", version: "0.1.0", build: 1 }) });
Object.assign(native.updates, {
  state: async () => structuredClone(state),
  check: async () => { calls.push("check"); return state = { phase: "available", version: "0.1.1", build: 2 }; },
  download: async () => { calls.push("download"); return state = { ...state, phase: "downloaded" }; },
  apply: async () => { calls.push("apply"); if (busy) throw new Error("模型、插件或登录任务正在运行"); return state; }, // User selects Later in the native confirmation.
});
Object.assign(native.system, { openURL: async ({ url }: { url: string }) => { calls.push(url); } });
const root = createRoot(document.getElementById("fixture")!);
const results: string[] = [];
const button = (text: string) => [...document.querySelectorAll("button")].find(b => b.textContent === text)!;
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function render(next: UpdateState) { state = next; calls = []; await act(async () => root.render(<UpdateSettings key={++generation} />)); }
async function click(text: string) { await act(async () => button(text).click()); }
async function run() {
  await render({ phase: "disabled" }); assert(button("检查更新").disabled, "Disabled builds must not contact update source"); results.push("PASS disabled builds");
  await render({ phase: "idle" }); await click("检查更新"); assert(button("下载更新"), "Available update offers download"); await click("下载更新"); assert(button("安装更新"), "Download offers install");
  await click("安装更新"); assert(button("安装更新") && state.phase === "downloaded", "Deferral keeps the downloaded candidate"); assert(calls.join(",") === "check,download,apply", "Use native update sequence"); results.push("PASS check, download and deferral");
  busy = true; await click("安装更新"); assert(document.querySelector('[role="alert"]')?.textContent?.includes("正在运行"), "Busy refusal is visible"); assert(!button("安装更新").disabled, "Busy refusal allows later retry"); busy = false; results.push("PASS busy refusal and retry");
  await render({ phase: "requiresInstall", version: "0.2.0", downloadURL: "https://github.com/potato47/malatang/releases/latest" }); await click("下载安装包"); assert(calls[0] === state.downloadURL, "Native changes open installer link"); results.push("PASS full installer fallback");
  await act(async () => { state = { phase: "failed", message: "Update rolled back" }; listeners.forEach(fn => fn()); }); assert(document.querySelector('[role="alert"]')?.textContent === "Update rolled back", "Background failures update UI"); results.push("PASS background update state");
  await act(async () => root.unmount()); assert(listeners.size === 0, "Unsubscribe on unmount");
  document.getElementById("results")!.textContent = results.join("\n"); document.documentElement.dataset.testStatus = "passed";
}
void run().catch(error => { document.getElementById("results")!.textContent = results.join("\n") + "\nFAIL " + error.stack; document.documentElement.dataset.testStatus = "failed"; });
