import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { native } from "@semicoder/fia/client";
import App from "./App";
import { ThemeProvider } from "./ThemeProvider";
import "./style.css";
function Root() { useEffect(() => { void native.ready(); }, []); return <ThemeProvider><App /></ThemeProvider>; }
createRoot(document.getElementById("root")!).render(<Root />);
