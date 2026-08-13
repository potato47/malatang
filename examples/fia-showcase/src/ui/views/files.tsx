import {
  Clipboard,
  Eye,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  AppEvent,
  DirectoryListing,
  FileEntry,
  FilePreview,
  FileRoot,
  RecentFileLocation,
} from "../../shared/contracts";
import { connectEvents, errorMessage, formatBytes, jsonRequest, requestJSON } from "../api";
import { Alert, Button, EmptyState, Modal, Spinner } from "../components/common";
import { Shell } from "../components/shell";
import { visibleRange } from "../virtual";

export function FilesView() {
  const [roots, setRoots] = useState<FileRoot[]>([]);
  const [recents, setRecents] = useState<RecentFileLocation[]>([]);
  const [rootId, setRootId] = useState("");
  const [relativePath, setRelativePath] = useState("");
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState("");
  const [scrollTop, setScrollTop] = useState(0);

  const loadRoots = useCallback(async () => {
    const value = await requestJSON<{ roots: FileRoot[]; recents: RecentFileLocation[] }>(
      "/api/files/roots",
    );
    setRoots(value.roots);
    setRecents(value.recents);
    if (rootId === "" && value.roots[0]) setRootId(value.roots[0].id);
  }, [rootId]);

  const reload = useCallback(async () => {
    if (rootId === "") {
      setListing(null);
      return;
    }
    setLoading(true);
    try {
      const parameters = new URLSearchParams({ root: rootId, relative: relativePath });
      if (showHidden) parameters.set("hidden", "1");
      setListing(await requestJSON<DirectoryListing>(`/api/files?${parameters}`));
      const recentState = await requestJSON<{
        roots: FileRoot[];
        recents: RecentFileLocation[];
      }>("/api/files/roots");
      setRecents(recentState.recents);
      setError("");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [relativePath, rootId, showHidden]);

  const updateWatch = useCallback(async () => {
    if (rootId === "") return;
    try {
      await requestJSON("/api/files/watch", jsonRequest("POST", { rootId, relativePath }));
    } catch (reason) {
      setError(`自动刷新不可用，可继续手动刷新：${errorMessage(reason)}`);
    }
  }, [relativePath, rootId]);

  useEffect(() => {
    void loadRoots().catch((reason) => setError(errorMessage(reason)));
  }, [loadRoots]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    void updateWatch();
    return () => {
      void requestJSON("/api/files/watch", jsonRequest("DELETE")).catch(() => undefined);
    };
  }, [updateWatch]);
  useEffect(
    () =>
      connectEvents((event: AppEvent) => {
        if (event.type === "files.changed") {
          void loadRoots();
          void reload();
        }
      }),
    [loadRoots, reload],
  );

  const addRoots = async () => {
    try {
      const value = await requestJSON<{ roots: FileRoot[]; recents: RecentFileLocation[] }>(
        "/api/files/roots",
        jsonRequest("POST"),
      );
      await loadRoots();
      if (value.roots[0]) {
        setRootId(value.roots[0].id);
        setRelativePath("");
      }
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const openEntry = async (entry: FileEntry) => {
    if (entry.kind === "directory") {
      setRelativePath(entry.relativePath);
      setPreview(null);
      return;
    }
    if (entry.kind !== "file") {
      setError("符号链接和特殊文件不会在工具箱中打开");
      return;
    }
    try {
      const parameters = new URLSearchParams({ root: rootId, relative: entry.relativePath });
      setPreview(await requestJSON<FilePreview>(`/api/files/preview?${parameters}`));
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const action = async (name: string, entry?: FileEntry, extra: Record<string, unknown> = {}) => {
    try {
      await requestJSON(
        "/api/files/actions",
        jsonRequest("POST", { action: name, rootId, relativePath: entry?.relativePath, ...extra }),
      );
      await reload();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const renameEntry = (entry: FileEntry) => {
    const name = prompt("输入新名称", entry.name);
    if (name && name !== entry.name) void action("rename", entry, { name });
  };
  const createDirectory = () => {
    const name = prompt("新文件夹名称");
    if (name)
      void action("create-directory", undefined, { directoryRelativePath: relativePath, name });
  };
  const trash = (entry: FileEntry) => {
    if (confirm(`将“${entry.name}”移到废纸篓？`)) void action("trash", entry);
  };
  const copyEntry = (entry: FileEntry) => {
    const destination = prompt(
      "复制到哪个目录？请输入当前根内的相对路径；根目录留空",
      relativePath,
    );
    if (destination !== null)
      void action("copy", entry, { destinationDirectoryRelativePath: destination });
  };
  const range = visibleRange(listing?.entries.length ?? 0, scrollTop, 480, 39);
  const visibleEntries = listing?.entries.slice(range.start, range.end) ?? [];

  return (
    <Shell
      title="文件管理"
      subtitle="所有操作限制在你显式添加的根目录内"
      actions={
        <>
          <Button onClick={createDirectory} disabled={!rootId}>
            <FolderPlus size={15} />
            新建文件夹
          </Button>
          <Button className="primary" onClick={() => void addRoots()}>
            <Plus size={15} />
            添加根目录
          </Button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <div className="file-manager">
        <aside className="roots-panel">
          <h3>位置</h3>
          {roots.map((root) => (
            <button
              key={root.id}
              className={root.id === rootId ? "active" : ""}
              onClick={() => {
                setRootId(root.id);
                setRelativePath("");
                setPreview(null);
              }}
            >
              <Folder size={16} />
              <span>
                <strong>{root.name}</strong>
                <small>已授权根目录</small>
              </span>
            </button>
          ))}
          {roots.length === 0 ? <p>尚未添加目录</p> : null}
          {recents.length > 0 ? <h3>最近访问</h3> : null}
          {recents.map((recent) => (
            <button
              key={`${recent.rootId}:${recent.relativePath}`}
              onClick={() => {
                setRootId(recent.rootId);
                setRelativePath(recent.relativePath);
                setPreview(null);
              }}
            >
              <FolderOpen size={16} />
              <span>
                <strong>{recent.relativePath || recent.rootName}</strong>
                <small>{recent.rootName}</small>
              </span>
            </button>
          ))}
        </aside>
        <section className="files-panel">
          {listing ? (
            <header className="path-bar">
              <button
                disabled={listing.parentRelativePath === null}
                onClick={() => setRelativePath(listing.parentRelativePath ?? "")}
              >
                ←
              </button>
              <span>
                <FolderOpen size={15} />
                {listing.root.name}
                {listing.relativePath ? ` / ${listing.relativePath}` : ""}
              </span>
              <label>
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(event) => setShowHidden(event.target.checked)}
                />
                隐藏文件
              </label>
              <button onClick={() => void reload()}>
                <RefreshCw size={14} />
              </button>
            </header>
          ) : null}
          {loading ? <Spinner /> : null}
          {!loading && roots.length === 0 ? (
            <EmptyState
              icon={<FolderPlus size={28} />}
              title="添加一个文件根目录"
              detail="FIA 会通过原生目录面板让你明确选择可管理范围。"
              action={
                <Button className="primary" onClick={() => void addRoots()}>
                  选择目录
                </Button>
              }
            />
          ) : null}
          {!loading && listing ? (
            <div className="file-table">
              <div className="file-row header">
                <span>名称</span>
                <span>大小</span>
                <span>修改时间</span>
                <span></span>
              </div>
              <div
                className="file-viewport"
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              >
                <div style={{ height: range.paddingTop }} />
                {visibleEntries.map((entry) => (
                  <div
                    className={`file-row ${entry.kind}`}
                    key={entry.relativePath}
                    onDoubleClick={() => void openEntry(entry)}
                  >
                    <span className="file-name">
                      {entry.kind === "directory" ? <Folder size={16} /> : <File size={16} />}
                      <strong>{entry.name}</strong>
                    </span>
                    <span>{formatBytes(entry.size)}</span>
                    <span>{new Date(entry.modifiedAt).toLocaleString()}</span>
                    <span className="file-actions">
                      <button title="预览/打开" onClick={() => void openEntry(entry)}>
                        <Eye size={14} />
                      </button>
                      {entry.kind === "file" ? (
                        <button
                          title="在当前目录复制副本"
                          onClick={() => void action("duplicate", entry)}
                        >
                          <Clipboard size={14} />
                        </button>
                      ) : null}
                      {entry.kind === "file" || entry.kind === "directory" ? (
                        <button title="复制到其他目录" onClick={() => copyEntry(entry)}>
                          <FolderOpen size={14} />
                        </button>
                      ) : null}
                      <button title="在访达中显示" onClick={() => void action("reveal", entry)}>
                        <FolderSearch2 size={14} />
                      </button>
                      <button title="重命名" onClick={() => renameEntry(entry)}>
                        <MoreHorizontal size={14} />
                      </button>
                      <button
                        className="danger-icon"
                        title="移到废纸篓"
                        onClick={() => trash(entry)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  </div>
                ))}
                <div style={{ height: range.paddingBottom }} />
              </div>
            </div>
          ) : null}
        </section>
      </div>
      {preview ? (
        <Modal title={preview.name} onClose={() => setPreview(null)}>
          <div className="preview-meta">
            {formatBytes(preview.size)} · {new Date(preview.modifiedAt).toLocaleString()}
          </div>
          <div className="preview-content">
            {preview.kind === "image" ? (
              <img src={preview.contentURL} alt={preview.name} />
            ) : preview.kind === "pdf" ? (
              <iframe src={preview.contentURL} title={preview.name} />
            ) : preview.kind === "text" ? (
              <pre>
                {preview.text}
                {preview.truncated ? "\n\n… 仅显示前 1 MiB" : ""}
              </pre>
            ) : (
              <EmptyState
                icon={<File size={28} />}
                title="暂不支持预览"
                detail="可以在系统默认应用中打开这个文件。"
              />
            )}
          </div>
          <footer className="modal-actions">
            <Button
              onClick={() =>
                void action("reveal", { relativePath: preview.relativePath } as FileEntry)
              }
            >
              <FolderSearch2 size={14} />
              在访达中显示
            </Button>
            <Button
              className="primary"
              onClick={() =>
                void action("open", { relativePath: preview.relativePath } as FileEntry)
              }
            >
              打开
            </Button>
          </footer>
        </Modal>
      ) : null}
    </Shell>
  );
}
