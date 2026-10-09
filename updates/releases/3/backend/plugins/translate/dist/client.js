// plugins/translate/src/page.module.css
var page_module_default = {
  "translation-toolbar": "translation-toolbar_hhYOwA",
  "language-flow": "language-flow_hhYOwA",
  "flow-arrow": "flow-arrow_hhYOwA",
  "translation-grid": "translation-grid_hhYOwA",
  "translation-card": "translation-card_hhYOwA",
  "tiny-dot": "tiny-dot_hhYOwA",
  accent: "accent_hhYOwA",
  "translation-input": "translation-input_hhYOwA",
  "result-card": "result-card_hhYOwA",
  "translation-output": "translation-output_hhYOwA",
  "translation-empty": "translation-empty_hhYOwA",
  "translation-art": "translation-art_hhYOwA",
  "translation-actions": "translation-actions_hhYOwA",
  "soft-spark": "soft-spark_hhYOwA",
  "typing-cursor": "typing-cursor_hhYOwA",
  "history-section": "history-section_hhYOwA",
  "section-title": "section-title_hhYOwA",
  "history-placeholder": "history-placeholder_hhYOwA",
  "history-list": "history-list_hhYOwA",
  "history-row": "history-row_hhYOwA",
  selected: "selected_hhYOwA",
  "history-icon": "history-icon_hhYOwA",
  "history-content": "history-content_hhYOwA",
  "history-date": "history-date_hhYOwA",
  muted: "muted_hhYOwA"
};

// malatang-host:react
var runtime = globalThis.__MALATANG_MODULES__?.["react"];
if (!runtime)
  throw new Error("需要麻辣烫 SDK 0.2 宿主，请重新构建插件");
var Activity = runtime.Activity;
var Children = runtime.Children;
var Component = runtime.Component;
var Fragment = runtime.Fragment;
var Profiler = runtime.Profiler;
var PureComponent = runtime.PureComponent;
var StrictMode = runtime.StrictMode;
var Suspense = runtime.Suspense;
var __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = runtime.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
var __COMPILER_RUNTIME = runtime.__COMPILER_RUNTIME;
var act = runtime.act;
var cache = runtime.cache;
var cacheSignal = runtime.cacheSignal;
var captureOwnerStack = runtime.captureOwnerStack;
var cloneElement = runtime.cloneElement;
var createContext = runtime.createContext;
var createElement = runtime.createElement;
var createRef = runtime.createRef;
var forwardRef = runtime.forwardRef;
var isValidElement = runtime.isValidElement;
var lazy = runtime.lazy;
var memo = runtime.memo;
var startTransition = runtime.startTransition;
var unstable_useCacheRefresh = runtime.unstable_useCacheRefresh;
var use = runtime.use;
var useActionState = runtime.useActionState;
var useCallback = runtime.useCallback;
var useContext = runtime.useContext;
var useDebugValue = runtime.useDebugValue;
var useDeferredValue = runtime.useDeferredValue;
var useEffect = runtime.useEffect;
var useEffectEvent = runtime.useEffectEvent;
var useId = runtime.useId;
var useImperativeHandle = runtime.useImperativeHandle;
var useInsertionEffect = runtime.useInsertionEffect;
var useLayoutEffect = runtime.useLayoutEffect;
var useMemo = runtime.useMemo;
var useOptimistic = runtime.useOptimistic;
var useReducer = runtime.useReducer;
var useRef = runtime.useRef;
var useState = runtime.useState;
var useSyncExternalStore = runtime.useSyncExternalStore;
var useTransition = runtime.useTransition;
var version = runtime.version;

// packages/sdk/src/client.ts
function createPluginClient(pluginId) {
  const bridge = globalThis.__MALATANG_BRIDGE__;
  if (!bridge)
    throw new Error("This plugin must be opened in Malatang.");
  const call = (method, input) => bridge.call(method, input);
  return {
    models: {
      list: () => call("models.list", {}),
      onChange: (listener) => bridge.on("models.changed", listener),
      start: (input) => call("models.generate", { pluginId, ...input })
    },
    runs: {
      list: () => call("runs.list", { pluginId }),
      get: (runId) => call("runs.get", { pluginId, runId }),
      cancel: (runId) => call("runs.cancel", { pluginId, runId }),
      onChange: (listener) => bridge.on("runs.changed", (payload) => {
        if (payload.pluginId === pluginId)
          listener();
      })
    },
    kv: {
      get: (key) => call("kv.get", { pluginId, key }),
      set: (key, value) => call("kv.set", { pluginId, key, value }),
      delete: (key) => call("kv.delete", { pluginId, key })
    },
    invoke: (method, input) => call("plugins.invoke", { pluginId, method, input }),
    onReconnect: bridge.onReconnect
  };
}

// malatang-host:@semicoder/malatang-sdk/ui
var runtime2 = globalThis.__MALATANG_MODULES__?.["@semicoder/malatang-sdk/ui"];
if (!runtime2)
  throw new Error("需要麻辣烫 SDK 0.2 宿主，请重新构建插件");
var Alert = runtime2.Alert;
var Badge = runtime2.Badge;
var Button = runtime2.Button;
var Checkbox = runtime2.Checkbox;
var Dialog = runtime2.Dialog;
var EmptyState = runtime2.EmptyState;
var Field = runtime2.Field;
var IconButton = runtime2.IconButton;
var Input = runtime2.Input;
var Loading = runtime2.Loading;
var Menu = runtime2.Menu;
var MenuItem = runtime2.MenuItem;
var ModelSelect = runtime2.ModelSelect;
var Page = runtime2.Page;
var PageHeader = runtime2.PageHeader;
var Panel = runtime2.Panel;
var PanelContent = runtime2.PanelContent;
var PanelFooter = runtime2.PanelFooter;
var PanelHeader = runtime2.PanelHeader;
var Popover = runtime2.Popover;
var Select = runtime2.Select;
var Switch = runtime2.Switch;
var Textarea = runtime2.Textarea;
var Tooltip = runtime2.Tooltip;
var UIProvider = runtime2.UIProvider;

// malatang-host:react/jsx-runtime
var runtime3 = globalThis.__MALATANG_MODULES__?.["react/jsx-runtime"];
if (!runtime3)
  throw new Error("需要麻辣烫 SDK 0.2 宿主，请重新构建插件");
var Fragment2 = runtime3.Fragment;
var jsx = runtime3.jsx;
var jsxs = runtime3.jsxs;

// plugins/translate/src/client.tsx
var client = createPluginClient("translate");
var sample = "Good tools disappear into the work. They give ideas room to grow, and make the complicated feel simple.";
var languages = ["简体中文", "English", "日本語", "한국어", "Français"];
var statusLabels = { running: "正在翻译", completed: "翻译完成", cancelled: "已停止", failed: "运行失败" };
function Translate() {
  const [text, setText] = useState(sample);
  const [target, setTarget] = useState("简体中文");
  const [modelId, setModelId] = useState("");
  const [models, setModels] = useState([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [runs, setRuns] = useState([]);
  const [current, setCurrent] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const selected = useRef(null);
  const alive = useRef(true);
  const busy = pending || current?.status === "running";
  const refresh = async () => {
    const items = await client.runs.list();
    if (!alive.current)
      return;
    setRuns(items);
    const restoring = !selected.current;
    const id = selected.current ?? items.find((item) => !item.demo)?.id;
    if (id) {
      selected.current = id;
      const run = await client.runs.get(id);
      if (alive.current && selected.current === id) {
        setCurrent((previous) => previous?.id === id && previous.revision > run.revision ? previous : run);
        if (restoring)
          setText(run.input);
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    const fail = (e) => alive.current && setError(String(e));
    let modelGeneration = 0;
    const refreshModels = async () => {
      const generation = ++modelGeneration;
      try {
        const items = await client.models.list();
        if (alive.current && generation === modelGeneration) {
          setModels(items);
          setModelsLoaded(true);
        }
      } catch (e) {
        if (generation === modelGeneration)
          fail(e);
      }
    };
    const off = client.runs.onChange(() => {
      refresh().catch(fail);
    });
    const modelsOff = client.models.onChange(() => void refreshModels());
    const reconnect = client.onReconnect(() => {
      refresh().catch(fail);
      refreshModels();
    });
    refreshModels();
    client.kv.get("preferences").then((value) => {
      if (alive.current && value && typeof value === "object" && !Array.isArray(value)) {
        if (typeof value.target === "string")
          setTarget(value.target);
        if (typeof value.modelId === "string")
          setModelId(value.modelId);
      }
    }).catch(fail);
    refresh().catch(fail);
    return () => {
      alive.current = false;
      modelGeneration++;
      off();
      modelsOff();
      reconnect();
    };
  }, []);
  useEffect(() => {
    if (modelsLoaded && !models.some((model) => model.id === modelId && model.configured))
      setModelId(models.find((model) => model.configured)?.id ?? "");
  }, [models, modelsLoaded, modelId]);
  const hasModel = models.some((model) => model.id === modelId && model.configured);
  const translate = async () => {
    if (!hasModel || busy || !text.trim())
      return;
    setPending(true);
    setError("");
    setCopied(false);
    try {
      const run = await client.invoke("translate", { text, target, modelId });
      selected.current = run.id;
      setCurrent(run);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  };
  const openRun = async (id) => {
    selected.current = id;
    setError("");
    setCopied(false);
    try {
      const run = await client.runs.get(id);
      if (selected.current === id) {
        setCurrent(run);
        setText(run.input);
        if (models.some((model) => model.id === run.modelId))
          setModelId(run.modelId);
      }
    } catch (e) {
      setError(String(e));
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(current?.output ?? "");
      setCopied(true);
    } catch {
      setError("无法访问剪贴板，请选中译文手动复制。");
    }
  };
  return /* @__PURE__ */ jsxs(Page, {
    children: [
      /* @__PURE__ */ jsx(PageHeader, {
        eyebrow: "A LITTLE LESS LOST IN TRANSLATION",
        title: "让表达，自在抵达。",
        description: "保留你的意思，也照顾另一种语言的语气。",
        actions: /* @__PURE__ */ jsx(Badge, {
          children: "译文 · 内置应用"
        })
      }),
      /* @__PURE__ */ jsxs("div", {
        className: page_module_default["translation-toolbar"],
        children: [
          /* @__PURE__ */ jsxs("div", {
            className: page_module_default["language-flow"],
            children: [
              /* @__PURE__ */ jsx("span", {
                children: "自动识别语言"
              }),
              /* @__PURE__ */ jsx("span", {
                className: page_module_default["flow-arrow"],
                children: "→"
              }),
              /* @__PURE__ */ jsx(Select, {
                "aria-label": "目标语言",
                value: target,
                disabled: busy,
                onChange: (e) => setTarget(e.target.value),
                children: languages.map((language) => /* @__PURE__ */ jsx("option", {
                  children: language
                }, language))
              })
            ]
          }),
          /* @__PURE__ */ jsx(ModelSelect, {
            "aria-label": "翻译模型",
            models,
            value: modelId,
            disabled: busy,
            onChange: (e) => setModelId(e.target.value)
          })
        ]
      }),
      /* @__PURE__ */ jsxs("div", {
        className: page_module_default["translation-grid"],
        children: [
          /* @__PURE__ */ jsxs(Panel, {
            className: page_module_default["translation-card"],
            children: [
              /* @__PURE__ */ jsxs(PanelHeader, {
                children: [
                  /* @__PURE__ */ jsxs("span", {
                    children: [
                      /* @__PURE__ */ jsx("i", {
                        className: page_module_default["tiny-dot"]
                      }),
                      "原文"
                    ]
                  }),
                  /* @__PURE__ */ jsx(Button, {
                    variant: "ghost",
                    disabled: busy,
                    onClick: () => setText(sample),
                    children: "载入示例 ↗"
                  })
                ]
              }),
              /* @__PURE__ */ jsx(Textarea, {
                "aria-label": "待翻译文本",
                placeholder: "写下或粘贴想翻译的文字…",
                className: page_module_default["translation-input"],
                value: text,
                maxLength: 16000,
                disabled: busy,
                onChange: (e) => setText(e.target.value),
                onKeyDown: (e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy && hasModel && text.trim()) {
                    e.preventDefault();
                    translate();
                  }
                }
              }),
              /* @__PURE__ */ jsxs(PanelFooter, {
                children: [
                  /* @__PURE__ */ jsxs("span", {
                    children: [
                      text.length.toLocaleString(),
                      " / 16,000"
                    ]
                  }),
                  /* @__PURE__ */ jsx("span", {
                    children: "⌘ ↵ 开始翻译"
                  })
                ]
              })
            ]
          }),
          /* @__PURE__ */ jsxs(Panel, {
            className: [page_module_default["translation-card"], page_module_default["result-card"]].join(" "),
            children: [
              /* @__PURE__ */ jsxs(PanelHeader, {
                children: [
                  /* @__PURE__ */ jsxs("span", {
                    children: [
                      /* @__PURE__ */ jsx("i", {
                        className: [page_module_default["tiny-dot"], page_module_default["accent"]].join(" ")
                      }),
                      "译文"
                    ]
                  }),
                  current ? /* @__PURE__ */ jsx(Badge, {
                    tone: current.status === "failed" ? "error" : current.status === "completed" ? "success" : "neutral",
                    children: statusLabels[current.status]
                  }) : /* @__PURE__ */ jsx("span", {
                    className: page_module_default["muted"],
                    children: "等一个好表达"
                  })
                ]
              }),
              /* @__PURE__ */ jsx("div", {
                className: page_module_default["translation-output"],
                "aria-live": "polite",
                "aria-label": "翻译结果",
                children: current?.output ? /* @__PURE__ */ jsxs("p", {
                  children: [
                    current.output,
                    current.status === "running" && /* @__PURE__ */ jsx("span", {
                      className: page_module_default["typing-cursor"]
                    })
                  ]
                }) : /* @__PURE__ */ jsxs("div", {
                  className: page_module_default["translation-empty"],
                  children: [
                    /* @__PURE__ */ jsxs("div", {
                      className: page_module_default["translation-art"],
                      children: [
                        /* @__PURE__ */ jsx("span", {
                          children: "A"
                        }),
                        /* @__PURE__ */ jsx("span", {
                          children: "文"
                        }),
                        /* @__PURE__ */ jsx("i", {
                          children: "✦"
                        })
                      ]
                    }),
                    /* @__PURE__ */ jsx("h3", {
                      children: busy ? "正在寻找合适的表达…" : "另一种语言，同样的你"
                    }),
                    /* @__PURE__ */ jsx("p", {
                      children: "译文会在这里，一点点呈现。"
                    })
                  ]
                })
              }),
              /* @__PURE__ */ jsxs(PanelFooter, {
                children: [
                  /* @__PURE__ */ jsx("span", {
                    children: current?.demo ? "历史演示记录 · 非真实模型" : current ? `${current.output.length} 字符` : "由宿主模型能力提供支持"
                  }),
                  /* @__PURE__ */ jsx(Button, {
                    variant: "ghost",
                    disabled: !current?.output,
                    onClick: () => void copy(),
                    children: copied ? "✓ 已复制" : "复制译文"
                  })
                ]
              })
            ]
          })
        ]
      }),
      /* @__PURE__ */ jsxs("div", {
        className: page_module_default["translation-actions"],
        children: [
          /* @__PURE__ */ jsxs("p", {
            children: [
              /* @__PURE__ */ jsx("span", {
                className: page_module_default["soft-spark"],
                children: "✦"
              }),
              !hasModel ? "请先在「设置 → 模型服务」添加并连接模型。" : "模型由宿主管理，插件无需单独配置 API Key。"
            ]
          }),
          busy ? /* @__PURE__ */ jsx(Button, {
            variant: "secondary",
            disabled: pending,
            onClick: () => current && void client.runs.cancel(current.id).then(setCurrent).catch((e) => setError(String(e))),
            children: "停止生成"
          }) : /* @__PURE__ */ jsxs(Button, {
            disabled: !text.trim() || !hasModel,
            onClick: () => void translate(),
            children: [
              "开始翻译 ",
              /* @__PURE__ */ jsx("span", {
                children: "↗"
              })
            ]
          })
        ]
      }),
      (error || current?.error) && /* @__PURE__ */ jsx(Alert, {
        children: error || current?.error
      }),
      /* @__PURE__ */ jsxs("section", {
        className: page_module_default["history-section"],
        children: [
          /* @__PURE__ */ jsxs("div", {
            className: page_module_default["section-title"],
            children: [
              /* @__PURE__ */ jsxs("h2", {
                children: [
                  "最近的译文 ",
                  /* @__PURE__ */ jsx("span", {
                    children: runs.length.toString().padStart(2, "0")
                  })
                ]
              }),
              /* @__PURE__ */ jsx("span", {
                children: "保存在本机"
              })
            ]
          }),
          runs.length ? /* @__PURE__ */ jsx("div", {
            className: page_module_default["history-list"],
            children: runs.slice(0, 5).map((run) => /* @__PURE__ */ jsxs(Button, {
              variant: "ghost",
              className: `${page_module_default["history-row"]} ${current?.id === run.id ? page_module_default.selected : ""}`,
              disabled: busy,
              onClick: () => void openRun(run.id),
              children: [
                /* @__PURE__ */ jsx("span", {
                  className: page_module_default["history-icon"],
                  children: "文"
                }),
                /* @__PURE__ */ jsxs("span", {
                  className: page_module_default["history-content"],
                  children: [
                    /* @__PURE__ */ jsx("strong", {
                      children: run.title
                    }),
                    /* @__PURE__ */ jsx("small", {
                      children: run.output || statusLabels[run.status]
                    })
                  ]
                }),
                /* @__PURE__ */ jsx("span", {
                  className: page_module_default["history-date"],
                  children: new Date(run.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
                }),
                /* @__PURE__ */ jsx("span", {
                  children: "↗"
                })
              ]
            }, run.id))
          }) : /* @__PURE__ */ jsx("div", {
            className: page_module_default["history-placeholder"],
            children: "每一次表达，都有迹可循。完成的翻译会保留在这里。"
          })
        ]
      })
    ]
  });
}
export {
  Translate as default
};
