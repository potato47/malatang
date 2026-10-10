import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  UIProvider,
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@semicoder/malatang-sdk/ui";
import { app } from "../bridge";
import { ThemeProvider, useTheme } from "../ThemeProvider";
import AppearanceSettings from "../AppearanceSettings";
import {
  defaultColorTheme,
  type AppearanceConfig,
  type AppearanceUpdate,
} from "../../shared/theme";
import "../tailwind.css";
import "../style.css";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let saved: AppearanceConfig = { theme: "dark", colorTheme: defaultColorTheme() };
let fail = false,
  calls = 0,
  systemDark = true;
const listeners = new Set<() => void>(),
  mediaListeners = new Set<() => void>();
const originalMedia = window.matchMedia.bind(window);
window.matchMedia = (query) =>
  query !== "(prefers-color-scheme: dark)"
    ? originalMedia(query)
    : ({
        get matches() {
          return systemDark;
        },
        media: query,
        onchange: null,
        addEventListener: (_: string, fn: () => void) => mediaListeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => mediaListeners.delete(fn),
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => true,
      } as unknown as MediaQueryList);
Object.assign(app, {
  call: async (method: string, patch: AppearanceUpdate) => {
    if (method === "appearance.set") {
      calls++;
      if (fail) throw new Error("storage offline");
      saved = { ...saved, ...structuredClone(patch) };
      listeners.forEach((fn) => fn());
    }
    return structuredClone(saved);
  },
  on: (_: string, listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  onReconnect: () => () => {},
});
let theme!: ReturnType<typeof useTheme>;
function Probe() {
  theme = useTheme();
  return (
    <UIProvider pluginId="theme-fixture">
      <Button id="plugin-button">插件按钮</Button>
      <Popover>
        <PopoverTrigger render={<Button>预览浮层</Button>} />
        <PopoverContent>主题浮层</PopoverContent>
      </Popover>
    </UIProvider>
  );
}
const root = createRoot(document.getElementById("fixture")!);
const results: string[] = [];
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const token = (key: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(`--m-${key}`).trim().toLowerCase();
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((node) => node.textContent === text)!;
async function click(text: string) {
  await act(async () => button(text).click());
}
async function render(visible = true) {
  await act(async () =>
    root.render(
      <ThemeProvider>
        <UIProvider>
          <AppearanceSettings visible={visible} />
          <Probe />
        </UIProvider>
      </ThemeProvider>,
    ),
  );
}
async function edit(label: string, value: string) {
  const id = [...document.querySelectorAll("label")].find(
    (node) => node.textContent === label,
  )!.htmlFor;
  const input = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function run() {
  await render();
  assert(token("bg") === "#0e0e0e", "saved mode loads");
  await act(async () => {
    await theme.saveColors({ ...defaultColorTheme(), preset: "github" });
  });
  assert(token("bg") === "#0d1117", "preset updates root");
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert(
    getComputedStyle(document.getElementById("plugin-button")!).backgroundColor ===
      "rgb(31, 111, 235)",
    "plugin inherits accent",
  );
  await click("预览浮层");
  assert(
    getComputedStyle(document.querySelector(".m-popover")!).backgroundColor !== "rgb(48, 48, 48)",
    "portal inherits theme",
  );
  results.push("PASS saved preset, plugin and Portal inheritance");
  const before = calls;
  await edit("强调色", "#8250DF");
  assert(
    token("accent") === "#8250df" && calls === before,
    "preview is local and does not persist",
  );
  await act(async () => {
    await theme.choose("light");
  });
  assert(token("accent") === "#0969da", "switching mode preserves independent draft colors");
  await act(async () => {
    await theme.choose("dark");
  });
  assert(token("accent") === "#8250df", "switching back retains the unsaved dark palette");
  await click("取消");
  assert(token("accent") === "#1f6feb", "cancel restores saved theme");
  await edit("前景", "#0D1117");
  assert(
    button("保存配色").disabled && document.querySelector('[role="alert"]'),
    "low contrast cannot save",
  );
  await click("取消");
  await edit("强调色", "#8250DF");
  fail = true;
  await click("保存配色");
  assert(
    document.body.textContent!.includes("主题保存失败") && saved.colorTheme.preset === "github",
    "save failure retains prior saved theme",
  );
  fail = false;
  await click("保存配色");
  assert(saved.colorTheme.custom.dark.accent === "#8250DF", "retry saves custom colors");
  results.push("PASS local preview, cancel, validation, save failure and retry");
  await edit("强调色", "#00FFFF");
  await render(false);
  assert(token("accent") === "#8250df", "hidden settings discard preview");
  await render();
  await act(async () => {
    await theme.choose("system");
  });
  assert(token("accent") === "#8250df", "system dark uses saved custom dark");
  await act(async () => {
    systemDark = false;
    mediaListeners.forEach((fn) => fn());
  });
  assert(
    token("bg") === "#ffffff" && token("accent") === "#0969da",
    "system change applies separate light palette",
  );
  await act(async () => {
    saved = { theme: "light", colorTheme: defaultColorTheme() };
    listeners.forEach((fn) => fn());
  });
  assert(
    token("bg") === "#fcfcfc" && !document.documentElement.style.getPropertyValue("--m-bg"),
    "remote reset clears all custom overrides",
  );
  results.push("PASS hidden cleanup, system switch and cross-window reset");
  await act(async () => root.unmount());
  assert(listeners.size === 0 && mediaListeners.size === 0, "subscriptions cleaned up");
  window.matchMedia = originalMedia;
  document.getElementById("results")!.textContent = results.join("\n");
  document.documentElement.dataset.testStatus = "passed";
}
void run().catch((error) => {
  document.getElementById("results")!.textContent = results.join("\n") + "\nFAIL " + error.stack;
  document.documentElement.dataset.testStatus = "failed";
});
