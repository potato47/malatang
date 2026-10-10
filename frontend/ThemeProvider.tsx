import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  colorTokens,
  defaultColorTheme,
  type AppearanceConfig,
  type AppearanceUpdate,
  type ColorMode,
  type ColorTheme,
  type ThemeMode,
} from "../shared/theme";
import { app } from "./bridge";

type ThemeState = AppearanceConfig & {
  resolved: ColorMode;
  ready: boolean;
  pending: boolean;
  error: string;
  choose: (theme: ThemeMode) => Promise<boolean>;
  saveColors: (colorTheme: ColorTheme) => Promise<boolean>;
  previewColors: (colorTheme: ColorTheme | null) => void;
};
const ThemeContext = createContext<ThemeState | null>(null);
export const useTheme = () => {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("ThemeProvider is missing");
  return theme;
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [appearance, setAppearance] = useState<AppearanceConfig>({
    theme: "system",
    colorTheme: defaultColorTheme(),
  });
  const [preview, previewColors] = useState<ColorTheme | null>(null);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const saving = useRef(false);
  const resolved =
    appearance.theme === "system" ? (systemDark ? "dark" : "light") : appearance.theme;
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(media.matches);
    media.addEventListener("change", change);
    change();
    return () => media.removeEventListener("change", change);
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = appearance.theme;
    const tokens = colorTokens(preview ?? appearance.colorTheme, resolved);
    for (const [key, value] of Object.entries(tokens)) root.style.setProperty(key, value);
    return () => {
      for (const key of Object.keys(tokens)) root.style.removeProperty(key);
    };
  }, [appearance, preview, resolved]);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const value = await app.call("appearance.get", {});
      if (request !== generation.current) return;
      setAppearance(value);
      setError("");
    } catch (e) {
      if (request === generation.current) setError("读取主题失败：" + String(e));
    } finally {
      if (request === generation.current) setReady(true);
    }
  }, []);
  useEffect(() => {
    const off = app.on("appearance.changed", () => void refresh());
    const reconnect = app.onReconnect(() => void refresh());
    void refresh();
    return () => {
      generation.current++;
      off();
      reconnect();
    };
  }, [refresh]);
  const save = async (patch: AppearanceUpdate) => {
    if (saving.current) return false;
    saving.current = true;
    setPending(true);
    setError("");
    try {
      const value = await app.call("appearance.set", patch);
      generation.current++;
      setAppearance(value);
      if (patch.colorTheme) previewColors(null);
      return true;
    } catch (e) {
      setError("主题保存失败，请重试：" + String(e));
      return false;
    } finally {
      saving.current = false;
      setPending(false);
    }
  };
  return (
    <ThemeContext.Provider
      value={{
        ...appearance,
        resolved,
        ready,
        pending,
        error,
        choose: (theme) => save({ theme }),
        saveColors: (colorTheme) => save({ colorTheme }),
        previewColors,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
