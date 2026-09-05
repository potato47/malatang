# Native Workbench

Run from the FIA repository: `swift run FIAWorkbenchExample`.
For a bundled release launch and automatic Quit/PID check: `python3 tools/smoke-native-workbench.py`.

The example keeps standard window buttons in AppKit's titlebar, places tabs in a titlebar accessory, preserves WebViews while switching tabs, toggles application appearance, and hides the application on user close. Dock reopen restores the main window. Two stable UUIDs select independent persistent WebKit stores. A simple stdin-driven CLI is owned by Runtime and gracefully stopped by an `onShutdown` callback.

Popup UI is intentionally absent; popups are cancelled. Downloads use an application-owned save panel. Titlebar layout is reference code, not a framework component.

Manual checks: type into each workspace; switch tabs; use the red button and Dock; minimize and restore; use ⌘H and ⌘Q; enter/exit fullscreen repeatedly in both themes. Observe the whole animation for button/layout jumps. Automatic smoke does not validate animation or macOS 14 compatibility.
