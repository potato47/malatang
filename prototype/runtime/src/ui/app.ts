function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`Missing element: ${id}`);
  return value as T;
}

const httpStatus = element<HTMLParagraphElement>("http-status");
const httpResult = element<HTMLElement>("http-result");
const wsStatus = element<HTMLParagraphElement>("ws-status");
const wsResult = element<HTMLElement>("ws-result");
const form = element<HTMLFormElement>("echo-form");
const input = element<HTMLInputElement>("echo-input");
const button = form.querySelector<HTMLButtonElement>("button");
if (button === null) throw new Error("Missing submit button");

async function loadHello(): Promise<void> {
  try {
    const response = await fetch("/api/hello", { credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as { message?: unknown };
    if (typeof payload.message !== "string") throw new Error("Invalid response");
    httpStatus.textContent = "Authenticated";
    httpStatus.dataset.state = "ok";
    httpResult.textContent = payload.message;
  } catch (error) {
    httpStatus.textContent = "Failed";
    httpStatus.dataset.state = "error";
    httpResult.textContent = error instanceof Error ? error.message : "Unknown error";
  }
}

const socketURL = new URL("/__fia/ws", window.location.href);
socketURL.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(socketURL, "fia.v1");
let nextID = 1;

socket.addEventListener("open", () => {
  wsStatus.textContent = "Connected with fia.v1";
  wsStatus.dataset.state = "ok";
  button.disabled = false;
});

socket.addEventListener("close", () => {
  wsStatus.textContent = "Disconnected";
  wsStatus.dataset.state = "error";
  button.disabled = true;
});

socket.addEventListener("error", () => {
  wsStatus.textContent = "Connection failed";
  wsStatus.dataset.state = "error";
});

socket.addEventListener("message", (event) => {
  wsResult.textContent = typeof event.data === "string" ? event.data : "Binary response";
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (socket.readyState !== WebSocket.OPEN) return;
  const message = input.value.trim();
  if (message.length === 0) return;
  socket.send(JSON.stringify({
    protocol: 1,
    type: "request",
    id: String(nextID++),
    method: "echo",
    params: { message },
  }));
});

void loadHello();

