import * as JSXDev from "react/jsx-dev-runtime";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as UI from "@semicoder/malatang-sdk/ui";
import * as React from "react";
import * as JSX from "react/jsx-runtime";
import { createClient } from "@semicoder/fia/client";
import type api from "../shared/api";
import type { HostBridge } from "@semicoder/malatang-sdk/types";
export const app = createClient<typeof api>();
// The host owns a single React runtime. Plugin builds use these explicit shared modules.
const bridge: HostBridge = {
  call: (method, input) => app.call(method as keyof typeof api.methods, input as never),
  on: (event, listener) => app.on(event as keyof typeof api.events, listener),
  onReconnect: listener => app.onReconnect(listener),
};
Object.assign(globalThis, { __MALATANG_MODULES__: { "react": React, "react/jsx-runtime": JSX, "react/jsx-dev-runtime": JSXDev, "react-dom": ReactDOM, "react-dom/client": ReactDOMClient, "@semicoder/malatang-sdk/ui": UI }, __MALATANG_BRIDGE__: bridge });
