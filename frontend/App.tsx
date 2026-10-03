import React, { useEffect, useState } from "react";
import { createClient } from "@semicoder/fia/client";
import type api from "../shared/api";
const app = createClient<typeof api>();
export default function App() {
  const [value, setValue] = useState<number>();
  const [error, setError] = useState("");
  useEffect(() => {
    const refresh = () => { void app.call("counter.get", {}).then(data => setValue(data.value)).catch(e => setError(String(e))); };
    const off = app.on("counter.changed", data => setValue(data.value));
    const reconnected = app.onReconnect(refresh);
    refresh();
    return () => { off(); reconnected(); };
  }, []);
  const increment = () => app.call("counter.increment", { by: 1 }).then(data => { setValue(data.value); setError(""); }).catch(e => setError(String(e)));
  return <main><span>FIA · HUMANS + AGENTS</span><h1>One shared counter.</h1><output>{value ?? "…"}</output><p><button onClick={() => void increment()}>Add one</button></p><p>Try the same operation from your agent:</p><code>malatang call counter.increment --json '{'{"by":1}'}'</code>{error && <p role="alert">{error}</p>}</main>;
}
