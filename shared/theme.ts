import { z } from "@semicoder/fia/api";

export const themeMode = z.enum(["system", "light", "dark"]);
export type ThemeMode = z.infer<typeof themeMode>;
export type ColorMode = "light" | "dark";
const hex = z.string().regex(/^#[0-9a-f]{6}$/i, "请输入完整的六位 HEX 颜色，如 #1F6FEB");
const palette = z
  .strictObject({ accent: hex, background: hex, foreground: hex })
  .refine((value) => contrast(value.background, value.foreground) >= 4.5, {
    message: "前景与背景的对比度需达到 4.5:1，请调整颜色。",
  });
export type Palette = z.infer<typeof palette>;
export const themePresets = {
  default: {
    light: { accent: "#242424", background: "#FCFCFC", foreground: "#0D0D0D" },
    dark: { accent: "#EDEDED", background: "#0E0E0E", foreground: "#EDEDED" },
  },
  github: {
    light: { accent: "#0969DA", background: "#FFFFFF", foreground: "#1F2328" },
    dark: { accent: "#1F6FEB", background: "#0D1117", foreground: "#E6EDF3" },
  },
} satisfies Record<string, Record<ColorMode, Palette>>;
export const colorThemeSchema = z.strictObject({
  preset: z.enum(["default", "github", "custom"]),
  custom: z.strictObject({ light: palette, dark: palette }),
});
export type ColorTheme = z.infer<typeof colorThemeSchema>;
export const defaultColorTheme = (): ColorTheme => ({
  preset: "default",
  custom: structuredClone(themePresets.default),
});
export const appearanceSchema = z.strictObject({ theme: themeMode, colorTheme: colorThemeSchema });
export const appearanceUpdate = appearanceSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export type AppearanceConfig = z.infer<typeof appearanceSchema>;
export type AppearanceUpdate = z.infer<typeof appearanceUpdate>;
export const paletteFor = (theme: ColorTheme, mode: ColorMode): Palette =>
  theme.preset === "custom" ? theme.custom[mode] : themePresets[theme.preset][mode];

function channels(color: string) {
  return [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));
}
function luminance(color: string) {
  const values = channels(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
}
export function contrast(a: string, b: string) {
  const first = luminance(a),
    second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
function mix(a: string, b: string, amount: number) {
  const end = channels(b);
  return (
    "#" +
    channels(a)
      .map((start, index) =>
        Math.round(start + (end[index]! - start) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function readable(color: string, backgrounds: string[], ratio = 4.5) {
  const destination = ["#000000", "#ffffff"].sort(
    (a, b) =>
      Math.min(...backgrounds.map((bg) => contrast(b, bg))) -
      Math.min(...backgrounds.map((bg) => contrast(a, bg))),
  )[0]!;
  for (let step = 0; step <= 100; step++) {
    const candidate = mix(color, destination, step / 100);
    if (backgrounds.every((bg) => contrast(candidate, bg) >= ratio)) return candidate;
  }
  return destination;
}

/** Runtime values inherit into SDK components, plugin scopes and their Portals. */
export function colorTokens(theme: ColorTheme, mode: ColorMode): Record<string, string> {
  if (theme.preset === "default") return {};
  const { background: bg, foreground: fg, accent } = paletteFor(theme, mode);
  const dark = luminance(bg) < 0.4;
  const surface = (amount: number) => {
    // Keep the user's foreground readable even for palettes near the minimum contrast.
    for (let step = amount; step > 0; step -= 0.005) {
      const value = mix(bg, fg, step);
      if (contrast(value, fg) >= 4.5) return value;
    }
    return bg;
  };
  const surfaces = [bg, surface(0.06), surface(0.12), surface(0.16)];
  const muted = readable(mix(bg, fg, 0.65), surfaces);
  const onAccent =
    contrast(accent, "#ffffff") >= contrast(accent, "#000000") ? "#ffffff" : "#000000";
  const sidebar = dark ? mix(bg, "#000000", 0.3) : surface(0.025);
  const tokens: Record<string, string> = {
    bg,
    text: fg,
    heading: fg,
    surface: surfaces[1]!,
    "surface-muted": surface(0.03),
    "surface-hover": surfaces[3]!,
    popup: surfaces[2]!,
    sidebar: contrast(sidebar, fg) >= 4.5 ? sidebar : bg,
    "sidebar-hover": surface(0.12),
    "sidebar-active": surface(0.16),
    "sidebar-text": fg,
    "sidebar-muted": muted,
    "text-secondary": muted,
    muted,
    placeholder: muted,
    line: mix(bg, fg, 0.18),
    "line-soft": mix(bg, fg, 0.1),
    "input-bg": surfaces[1]!,
    "input-border": mix(bg, fg, 0.24),
    accent,
    "accent-hover": mix(accent, onAccent === "#ffffff" ? "#000000" : "#ffffff", 0.08),
    "accent-border": mix(bg, accent, 0.5),
    "on-accent": onAccent,
    focus: readable("#3a83f7", surfaces, 3),
    "button-secondary": surfaces[2]!,
    "button-secondary-hover": surfaces[3]!,
    selection: surface(0.16),
    "art-bg": surfaces[2]!,
    "art-text": muted,
    shadow: dark ? "#0000005c" : "#00000020",
    overlay: dark ? "#00000080" : "#00000040",
  };
  for (const [name, color] of Object.entries({
    success: "#287d3c",
    warning: "#8a6800",
    error: "#c42b1c",
  })) {
    const statusBackground = mix(bg, color, 0.09);
    tokens[name] = readable(color, [...surfaces, statusBackground]);
    tokens[`${name}-bg`] = statusBackground;
    tokens[`${name}-line`] = mix(bg, tokens[name]!, 0.3);
  }
  return Object.fromEntries(Object.entries(tokens).map(([key, value]) => [`--m-${key}`, value]));
}
