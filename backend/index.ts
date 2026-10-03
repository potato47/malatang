import { defineBackend, implementAPI } from "@semicoder/fia/backend";
import { rename } from "node:fs/promises";
import { resolve } from "node:path";
import api from "../shared/api";

let value = 0;
let queue = Promise.resolve();
export default defineBackend({
  api: implementAPI(api, {
    "counter.get": () => ({ value }),
    "counter.increment": (input, context) => {
      const result = queue.then(async () => {
        context.signal.throwIfAborted();
        const next = value + input.by;
        if (!Number.isSafeInteger(next)) throw new Error("Counter exceeds safe integer range");
        const path = resolve(context.app.dataDirectory, "counter.json");
        await Bun.write(path + ".tmp", JSON.stringify({ value: next }));
        await rename(path + ".tmp", path);
        value = next;
        context.emit("counter.changed", { value });
        return { value };
      });
      queue = result.then(() => {}, () => {});
      return result;
    },
  }),
  async start({ app, native }) {
    const file = Bun.file(resolve(app.dataDirectory, "counter.json"));
    if (await file.exists()) value = api.methods["counter.get"].output.parse(await file.json()).value;
    await native.windows.setTitlebar({ id: "main", items: [{ type: "text", id: "status", label: "Humans + agents" }] });
  },
});
