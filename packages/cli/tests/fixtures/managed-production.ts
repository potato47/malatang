import { defineApp } from "../../src/runtime.ts";
import { startManagedRuntime } from "../../src/runtime/managed.ts";

const application = defineApp({
  backend: {
    methods: {
      async greet(input: { name: string }, context) {
        await context.emit("greet.completed", input);
        return { message: `Hello, ${input.name}` };
      },
      async hold(_input: null, context) {
        await new Promise<void>((resolvePromise) => {
          context.signal.addEventListener("abort", () => resolvePromise(), { once: true });
        });
        await context.emit("hold.cancelled", { requestID: context.requestID });
        return { late: true };
      },
    },
  },
  routes: {
    "/api/test": () => Response.json({ managed: true }),
    "/ws": (request, server) => {
      if (server.upgrade(request)) return;
      return new Response("upgrade required", { status: 426 });
    },
  },
  websocket: {
    message(socket, message) {
      socket.send(`application:${String(message)}`);
    },
  },
});

await startManagedRuntime({
  mode: "production",
  application,
  uiTemplate: '<!doctype html><style nonce="__FIA_CSP_NONCE__"></style><script nonce="__FIA_CSP_NONCE__"></script>',
});
