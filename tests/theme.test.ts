import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Appearance } from "../backend/appearance";
import { Store } from "../backend/store";
import {
  colorTokens,
  contrast,
  defaultColorTheme,
  themePresets,
  type AppearanceConfig,
} from "../shared/theme";
const directories: string[] = [];
afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "malatang-theme-"));
  directories.push(dir);
  const store = new Store(dir);
  await store.open();
  return { store, dir };
}

test("custom palettes persist independently of native mode, survive restart, and preserve plugin data", async () => {
  const { store, dir } = await setup();
  await store.set("notes", "draft", "保留笔记");
  const { colorTheme: _colors, ...old } = store.value;
  await Bun.write(join(dir, "platform.json"), JSON.stringify(old));
  const migrated = new Store(dir);
  await migrated.open();
  expect(migrated.value.colorTheme).toEqual(defaultColorTheme());
  const native: string[] = [],
    events: AppearanceConfig[] = [];
  const appearance = new Appearance(
    migrated,
    async (mode) => {
      native.push(mode);
    },
    (value) => events.push(value),
  );
  const custom = { preset: "custom" as const, custom: structuredClone(themePresets.github) };
  await Promise.all([appearance.set({ colorTheme: custom }), appearance.set({ theme: "dark" })]);
  expect(native).toEqual(["dark"]);
  expect(events).toHaveLength(2);
  expect(events[0]!.colorTheme).toEqual(custom);
  expect(appearance.get()).toEqual({ theme: "dark", colorTheme: custom });
  const reopened = new Store(dir);
  await reopened.open();
  expect(reopened.value.colorTheme).toEqual(custom);
  expect(reopened.get("notes", "draft")).toBe("保留笔记");
  const copy = appearance.get();
  copy.colorTheme.custom.dark.accent = "#000000";
  expect(appearance.get().colorTheme.custom.dark.accent).toBe("#1F6FEB");
});

test("invalid colors and unreadable text are rejected without native, disk or event changes", async () => {
  const { store, dir } = await setup();
  const before = await Bun.file(join(dir, "platform.json")).text();
  const appearance = new Appearance(
    store,
    async () => {
      throw new Error("must not call native");
    },
    () => {
      throw new Error("must not emit");
    },
  );
  for (const background of ["red", "#fff", "#ffffff; color: red", "#0D0D0D"]) {
    const colorTheme = defaultColorTheme();
    colorTheme.preset = "custom";
    colorTheme.custom.light.background = background;
    await expect(appearance.set({ colorTheme })).rejects.toThrow();
  }
  expect(await Bun.file(join(dir, "platform.json")).text()).toBe(before);
});

test("failed persistence rolls native mode back and leaves the saved palette untouched", async () => {
  const { store } = await setup();
  const native: string[] = [],
    events: AppearanceConfig[] = [];
  const appearance = new Appearance(
    store,
    async (mode) => {
      native.push(mode);
    },
    (value) => events.push(value),
  );
  store.update = async () => {
    throw new Error("disk unavailable");
  };
  const colorTheme = { ...defaultColorTheme(), preset: "github" as const };
  await expect(appearance.set({ theme: "dark", colorTheme })).rejects.toThrow("disk unavailable");
  expect(native).toEqual(["dark", "system"]);
  expect(events).toEqual([]);
  expect(appearance.get()).toEqual({ theme: "system", colorTheme: defaultColorTheme() });
});

test("derived palettes retain readable controls across varied valid backgrounds and accents", () => {
  expect(colorTokens(defaultColorTheme(), "dark")).toEqual({});
  for (const [background, foreground] of [
    ["#FFFFFF", "#1F2328"],
    ["#0D1117", "#E6EDF3"],
    ["#FFF7ED", "#472F19"],
    ["#777777", "#000000"],
  ]) {
    for (const accent of ["#000000", "#ffffff", "#1F6FEB", "#787878", "#ff0000", "#ffff00"]) {
      const palette = { background: background!, foreground: foreground!, accent };
      const tokens = colorTokens(
        { preset: "custom", custom: { light: palette, dark: palette } },
        "light",
      );
      expect(tokens["--m-bg"]).toBe(background!);
      for (const bg of ["bg", "surface", "surface-hover", "popup", "input-bg", "sidebar"]) {
        expect(contrast(tokens[`--m-${bg}`]!, tokens["--m-text"]!)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens[`--m-${bg}`]!, tokens["--m-muted"]!)).toBeGreaterThanOrEqual(4.5);
      }
      for (const bg of ["accent", "accent-hover"])
        expect(contrast(tokens[`--m-${bg}`]!, tokens["--m-on-accent"]!)).toBeGreaterThanOrEqual(
          4.5,
        );
    }
  }
});
