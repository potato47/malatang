import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ThemeMode } from "../shared/api";
import { app } from "./bridge";

type ThemeState = { theme: ThemeMode; ready: boolean; pending: boolean; error: string; choose: (theme: ThemeMode) => Promise<boolean> };
const ThemeContext = createContext<ThemeState | null>(null);
export const useTheme = () => {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("ThemeProvider is missing");
  return theme;
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>("system");
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const saving = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const value = await app.call("appearance.get", {});
      if (request !== generation.current) return;
      document.documentElement.dataset.theme = value.theme;
      setTheme(value.theme);
      setError("");
    } catch (e) {
      if (request === generation.current) setError("读取主题失败：" + String(e));
    } finally { if (request === generation.current) setReady(true); }
  }, []);
  useEffect(() => {
    const off = app.on("appearance.changed", () => void refresh());
    const reconnect = app.onReconnect(() => void refresh());
    void refresh();
    return () => { generation.current++; off(); reconnect(); };
  }, [refresh]);
  const choose = async (next: ThemeMode) => {
    if (saving.current) return false;
    saving.current = true;
    setPending(true);
    setError("");
    try {
      await app.call("appearance.set", { theme: next });
      await refresh();
      return true;
    } catch (e) { setError("主题保存失败，请重试：" + String(e)); return false; }
    finally { saving.current = false; setPending(false); }
  };
  return <ThemeContext.Provider value={{ theme, ready, pending, error, choose }}>{children}</ThemeContext.Provider>;
}
