import type { BackendServer } from "@semicoder/fia/backend";
import type { AppEvent } from "../shared/contracts";

export interface ShowcaseSocketData {
  connectedAt: number;
}

const TOPIC = "showcase-events";

export class EventBroker {
  #server: BackendServer<ShowcaseSocketData> | null = null;

  attach(server: BackendServer<ShowcaseSocketData>): void {
    this.#server = server;
  }

  detach(): void {
    this.#server = null;
  }

  subscribe(socket: Bun.ServerWebSocket<ShowcaseSocketData>): void {
    socket.subscribe(TOPIC);
    socket.send(
      JSON.stringify({ type: "ready", timestamp: new Date().toISOString() } satisfies AppEvent),
    );
  }

  publish(event: AppEvent): void {
    this.#server?.publish(TOPIC, JSON.stringify(event));
  }
}
