# Malatang

Run bun install and bun run dev (or bun run dev --open-browser). The dev output includes a one-use browser link valid for 60 seconds; obtain another with bun run agent open --browser --url, including after backend restart. In another terminal run bun run agent call counter.increment --json '{"by":1}'.

Edit shared/api.ts for the contract, backend/ for handlers, frontend/ for UI, and agent/instructions.md for business guidance. bun run build produces an application with its own CLI and Bun runtime. Use the app menu to install the command; then run malatang skill install to install its skill.

CLI startup stays in the tray; malatang open shows the window. Explicitly quit to stop the backend. Scripts are trusted local code.
