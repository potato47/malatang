import { Clipboard, File, Folder, FolderSearch2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FileRoot, SearchResponse, SearchResult } from "../../shared/contracts";
import { errorMessage, formatBytes, jsonRequest, requestJSON } from "../api";
import { Alert, EmptyState, IconButton, Spinner } from "../components/common";

export function SearchView() {
  const [query, setQuery] = useState("");
  const [roots, setRoots] = useState<FileRoot[]>([]);
  const [selectedRoots, setSelectedRoots] = useState<string[]>([]);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const generation = useRef(0);
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    void requestJSON<{ roots: FileRoot[] }>("/api/files/roots").then((value) =>
      setRoots(value.roots),
    );
  }, []);

  useEffect(() => {
    const blur = () =>
      setTimeout(() => {
        if (!document.hasFocus())
          void requestJSON("/api/windows/search", jsonRequest("DELETE")).catch(() => undefined);
      }, 120);
    window.addEventListener("blur", blur);
    return () => window.removeEventListener("blur", blur);
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    if (query.trim().length === 0) {
      setResponse(null);
      setError("");
      setLoading(false);
      return;
    }
    if (composing.current) return;
    setLoading(true);
    const timer = setTimeout(() => {
      const parameters = new URLSearchParams({ q: query, limit: "100" });
      for (const root of selectedRoots) parameters.append("root", root);
      void requestJSON<SearchResponse>(`/api/search?${parameters}`)
        .then((value) => {
          if (generation.current === current) {
            setResponse(value);
            setActiveIndex(0);
            setError("");
          }
        })
        .catch((reason) => {
          if (
            generation.current === current &&
            (reason as { code?: string }).code !== "SEARCH_SUPERSEDED"
          )
            setError(errorMessage(reason));
        })
        .finally(() => {
          if (generation.current === current) setLoading(false);
        });
    }, 120);
    return () => clearTimeout(timer);
  }, [query, selectedRoots]);

  const action = async (result: SearchResult, name: "open" | "reveal" | "copy-path") => {
    try {
      await requestJSON(
        "/api/search/action",
        jsonRequest("POST", { token: result.token, action: name }),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const keyboard = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void requestJSON("/api/windows/search", jsonRequest("DELETE"));
      return;
    }
    if (composing.current) return;
    const results = response?.results ?? [];
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((value) => Math.min(value + 1, Math.max(0, results.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      void action(results[activeIndex], "open");
    }
  };

  return (
    <main className="search-window">
      <header className="search-bar">
        <Search size={21} />
        <input
          ref={input}
          value={query}
          onChange={(event) => {
            if (!composing.current) setQuery(event.target.value);
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(event) => {
            composing.current = false;
            setQuery(event.currentTarget.value);
          }}
          onKeyDown={keyboard}
          placeholder="搜索文件名、类型、作者或 Finder 标签…"
          aria-label="搜索文件"
        />
        {loading ? (
          <span className="search-loader">
            <Spinner label="" />
          </span>
        ) : query ? (
          <IconButton label="清除" onClick={() => setQuery("")}>
            <X size={16} />
          </IconButton>
        ) : (
          <kbd>⌥ Space</kbd>
        )}
      </header>
      {roots.length > 0 ? (
        <div className="scope-row">
          <span>范围</span>
          <button
            className={selectedRoots.length === 0 ? "selected" : ""}
            onClick={() => setSelectedRoots([])}
          >
            整台 Mac
          </button>
          {roots.map((root) => (
            <button
              key={root.id}
              className={selectedRoots.includes(root.id) ? "selected" : ""}
              onClick={() =>
                setSelectedRoots((values) =>
                  values.includes(root.id)
                    ? values.filter((id) => id !== root.id)
                    : [...values, root.id],
                )
              }
            >
              {root.name}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      <section className="search-results">
        {query.length === 0 ? (
          <EmptyState
            icon={<Search size={28} />}
            title="快速找到任何文件"
            detail="匹配名称、文件类型、作者与 Finder 标签；不搜索正文内容。"
          />
        ) : null}
        {response?.results.length === 0 && !loading ? (
          <EmptyState
            icon={<Search size={28} />}
            title="没有找到结果"
            detail="试试更短的关键词，或切换搜索范围。"
          />
        ) : null}
        {response?.results.map((result, index) => (
          <article
            key={result.token}
            className={`search-result ${index === activeIndex ? "active" : ""}`}
            onMouseEnter={() => setActiveIndex(index)}
            onDoubleClick={() => void action(result, "open")}
          >
            <span className={`file-kind ${result.kind}`}>
              {result.kind === "directory" ? <Folder size={18} /> : <File size={18} />}
            </span>
            <div>
              <strong>{result.name}</strong>
              <span>{result.locationLabel}</span>
              <small>
                {result.kindLabel ??
                  result.contentType ??
                  (result.kind === "directory" ? "文件夹" : "文件")}
                {result.size === null ? "" : ` · ${formatBytes(result.size)}`}
                {result.tags.length ? ` · ${result.tags.join("、")}` : ""}
              </small>
            </div>
            <div className="result-actions">
              <button title="复制路径" onClick={() => void action(result, "copy-path")}>
                <Clipboard size={14} />
              </button>
              <button title="在访达中显示" onClick={() => void action(result, "reveal")}>
                <FolderSearch2 size={14} />
              </button>
            </div>
          </article>
        ))}
      </section>
      {response ? (
        <footer className="search-footer">
          {response.results.length} 个结果 · {response.elapsedMs} ms
          {response.truncated ? " · 已截断" : ""}
          <span>双击打开</span>
        </footer>
      ) : null}
    </main>
  );
}
