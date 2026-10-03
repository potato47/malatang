/** SSE parser preserves UTF-8 and frame boundaries across arbitrary network chunks. */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let data: string[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      if (pending.length > 2 * 1024 * 1024) throw new Error("模型返回的单个流片段过大");
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end).replace(/\r$/, "");
        pending = pending.slice(end + 1);
        if (line === "") { if (data.length) { yield data.join("\n"); data = []; } }
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (chunk.done) { if (pending.startsWith("data:")) data.push(pending.slice(5).trim()); if (data.length) yield data.join("\n"); break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
