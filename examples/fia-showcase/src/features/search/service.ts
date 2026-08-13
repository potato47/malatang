import { lstat } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { ShowcaseRepository } from "../../lib/database";
import { AppError } from "../../lib/http";
import type { SearchResponse, SearchResult } from "../../shared/contracts";
import { buildSpotlightQuery, normalizeSearchText } from "./query";

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const METADATA_CONCURRENCY = 8;

type SearchChild = Bun.Subprocess<"ignore", "pipe", "pipe">;
type SpawnChild = (argumentsList: string[]) => SearchChild;

const spawnChild: SpawnChild = (argumentsList) =>
  Bun.spawn(argumentsList, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });

async function collectPaths(
  child: SearchChild,
  limit: number,
): Promise<{ paths: string[]; truncated: boolean }> {
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  const paths: string[] = [];
  let truncated = false;
  try {
    while (paths.length <= limit) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > MAX_OUTPUT_BYTES) {
        truncated = true;
        child.kill();
        break;
      }
      buffer += decoder.decode(result.value, { stream: true });
      const values = buffer.split("\0");
      buffer = values.pop() ?? "";
      for (const path of values) {
        if (path.length > 0) paths.push(path);
        if (paths.length > limit) {
          truncated = true;
          child.kill();
          break;
        }
      }
    }
    return { paths: paths.slice(0, limit), truncated };
  } finally {
    reader.releaseLock();
  }
}

function metadataValue(output: string, key: string): string | null {
  const escapedKey = key.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escapedKey} = (.+)$`, "m").exec(output);
  if (match?.[1] === undefined || match[1] === "(null)") return null;
  const value = match[1].trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function metadataList(output: string, key: string): string[] {
  const escapedKey = key.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escapedKey} = \\(([^]*?)^\\)$`, "m").exec(output);
  if (match?.[1] === undefined) return [];
  return [...match[1].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((item) => {
    try {
      return JSON.parse(`"${item[1] ?? ""}"`) as string;
    } catch {
      return item[1] ?? "";
    }
  });
}

async function mapConcurrent<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const output = Array.from({ length: values.length }) as Output[];
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= values.length) return;
      output[current] = await mapper(values[current]!);
    }
  });
  await Promise.all(workers);
  return output;
}

export class SpotlightSearchService {
  #generation = 0;
  readonly #children = new Set<SearchChild>();
  readonly #tokens = new Map<string, { path: string; expiresAt: number }>();

  constructor(
    private readonly repository: ShowcaseRepository,
    private readonly spawn: SpawnChild = spawnChild,
  ) {}

  async search(input: {
    query: unknown;
    rootIds?: readonly string[];
    limit?: number;
  }): Promise<SearchResponse> {
    const generation = ++this.#generation;
    for (const child of this.#children) child.kill();
    this.#children.clear();
    const query = normalizeSearchText(input.query);
    const expression = buildSpotlightQuery(query);
    const requestedLimit = Math.floor(input.limit ?? 80);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 200) : 80;
    const roots = (input.rootIds ?? [])
      .map((id) => this.repository.getRoot(id))
      .filter((root) => root !== null);
    if ((input.rootIds?.length ?? 0) > 0 && roots.length !== input.rootIds!.length) {
      throw new AppError("ROOT_NOT_FOUND", "搜索范围中包含不存在的根目录", 404);
    }
    const scopes = roots.length === 0 ? [null] : roots.map((root) => root.path);
    const started = performance.now();
    const unique = new Set<string>();
    let truncated = false;

    try {
      for (const scope of scopes) {
        this.#assertCurrent(generation);
        const argumentsList = ["/usr/bin/mdfind", "-0"];
        if (scope !== null) argumentsList.push("-onlyin", scope);
        argumentsList.push(expression);
        const child = this.spawn(argumentsList);
        this.#children.add(child);
        const timeout = setTimeout(() => child.kill(), 8_000);
        const collected = await collectPaths(child, limit - unique.size);
        clearTimeout(timeout);
        const exitCode = await child.exited;
        const diagnostic = await new Response(child.stderr).text();
        this.#children.delete(child);
        this.#assertCurrent(generation);
        if (exitCode !== 0 && !collected.truncated) {
          console.warn("mdfind 搜索失败", diagnostic.trim());
          throw new AppError("SPOTLIGHT_FAILED", "Spotlight 搜索失败，请检查索引状态", 503);
        }
        for (const path of collected.paths) unique.add(path);
        truncated ||= collected.truncated;
        if (unique.size >= limit) {
          truncated = true;
          break;
        }
      }

      const candidates = await mapConcurrent(
        [...unique].slice(0, limit),
        METADATA_CONCURRENCY,
        async (path) => await this.#resultForPath(path, generation),
      );
      this.#assertCurrent(generation);
      const results = candidates.filter((result) => result !== null);
      this.repository.recordSearch(query, results.length);
      return {
        query,
        results,
        elapsedMs: Math.round(performance.now() - started),
        truncated,
      };
    } finally {
      if (generation === this.#generation) {
        for (const child of this.#children) child.kill();
        this.#children.clear();
      }
    }
  }

  recent() {
    return this.repository.recentSearches();
  }

  dispose(): void {
    this.#generation += 1;
    for (const child of this.#children) child.kill();
    this.#children.clear();
    this.#tokens.clear();
  }

  resultPath(token: string): string {
    const value = this.#tokens.get(token);
    if (value === undefined || value.expiresAt <= Date.now()) {
      this.#tokens.delete(token);
      throw new AppError("SEARCH_RESULT_EXPIRED", "搜索结果已失效，请重新搜索", 404);
    }
    return value.path;
  }

  async #resultForPath(path: string, generation: number): Promise<SearchResult | null> {
    try {
      const information = await lstat(path);
      if (!information.isFile() && !information.isDirectory()) return null;
      const child = this.spawn([
        "/usr/bin/mdls",
        "-name",
        "kMDItemDisplayName",
        "-name",
        "kMDItemContentType",
        "-name",
        "kMDItemKind",
        "-name",
        "kMDItemAuthors",
        "-name",
        "kMDItemUserTags",
        path,
      ]);
      this.#children.add(child);
      const timeout = setTimeout(() => child.kill(), 2_000);
      const output = await new Response(child.stdout).text();
      await child.exited;
      clearTimeout(timeout);
      this.#children.delete(child);
      this.#assertCurrent(generation);
      const token = crypto.randomUUID().replaceAll("-", "");
      this.#tokens.set(token, { path, expiresAt: Date.now() + 5 * 60_000 });
      return {
        token,
        name: metadataValue(output, "kMDItemDisplayName") ?? basename(path),
        locationLabel: basename(dirname(path)) || "Mac",
        kind: information.isDirectory() ? "directory" : "file",
        size: information.isFile() ? information.size : null,
        modifiedAt: information.mtime.toISOString(),
        createdAt: information.birthtime.toISOString(),
        contentType: metadataValue(output, "kMDItemContentType"),
        kindLabel: metadataValue(output, "kMDItemKind"),
        authors: metadataList(output, "kMDItemAuthors"),
        tags: metadataList(output, "kMDItemUserTags"),
      };
    } catch (error) {
      if (error instanceof AppError && error.code === "SEARCH_SUPERSEDED") throw error;
      return null;
    }
  }

  #assertCurrent(generation: number): void {
    if (generation !== this.#generation) {
      throw new AppError("SEARCH_SUPERSEDED", "搜索已被更新的查询替代", 409);
    }
  }
}

export function likelyPreviewable(path: string): boolean {
  return [
    ".txt",
    ".md",
    ".json",
    ".ts",
    ".tsx",
    ".js",
    ".css",
    ".html",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".pdf",
  ].includes(extname(path).toLowerCase());
}
