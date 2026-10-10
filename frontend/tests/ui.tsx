import "../tailwind.css";
// Open /tests/ui.html on the development URL. Keyboard Tab is also checked in WKWebView.
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Button,
  Dialog,
  Field,
  Input,
  Popover,
  Switch,
  UIProvider,
  useToast,
  PopoverTrigger,
  PopoverContent,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@semicoder/malatang-sdk/ui";
import "@semicoder/malatang-sdk/theme.css";
import "@semicoder/malatang-sdk/ui.css";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.getElementById("fixture")!;
const root = createRoot(container),
  results: string[] = [];
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function find<T extends Element = HTMLElement>(selector: string) {
  const node = container.querySelector<T>(selector);
  assert(node, `Missing ${selector}`);
  return node;
}
async function click(selector: string) {
  await act(async () => {
    find<HTMLElement>(selector).click();
  });
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
async function escape() {
  await act(async () => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  await settle();
}
function ToastFixture() {
  const toast = useToast();
  return (
    <Button id="toast-trigger" onClick={() => toast.add({ title: "页面通知", timeout: 0 })}>
      通知
    </Button>
  );
}
function Fixture({ visible }: { visible: boolean }) {
  const [checked, setChecked] = useState(false);
  return (
    <UIProvider visible={visible}>
      <div hidden={!visible}>
        <Field label="标题" id="title" error="必填">
          <Input />
        </Field>
        <ToastFixture />
        <Button id="small" size="sm">
          小按钮
        </Button>
        <Button id="medium">中按钮</Button>
        <Button id="loading" loading>
          保存中
        </Button>
        <Switch id="switch" checked={checked} onCheckedChange={setChecked} aria-label="自动保存" />
        <Dialog>
          <DialogTrigger render={<Button id="dialog-trigger">对话框</Button>} />
          <DialogContent>
            <DialogTitle>{"测试对话框"}</DialogTitle>
            <DialogDescription>{"验证嵌套与清理"}</DialogDescription>
            <Input aria-label="对话框输入" />
            <Popover>
              <PopoverTrigger render={<Button id="nested-trigger">嵌套</Button>} />
              <PopoverContent>
                <Input aria-label="嵌套输入" />
              </PopoverContent>
            </Popover>
            <DialogFooter>
              <DialogClose render={<Button variant="secondary" />}>关闭</DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Popover>
          <PopoverTrigger render={<Button id="popover-trigger">保留浮层</Button>} />
          <PopoverContent>
            <Input aria-label="保留输入" />
          </PopoverContent>
        </Popover>
      </div>
    </UIProvider>
  );
}
async function render(visible: boolean) {
  await act(async () => {
    root.render(<Fixture visible={visible} />);
  });
}
async function run() {
  await render(true);
  await click('label[for="title"]');
  assert(document.activeElement === find("#title"), "Label must focus the control");
  assert(
    find("#title").getAttribute("aria-describedby") === "title-description" &&
      find("#title").getAttribute("aria-invalid") === "true",
    "Error must be associated",
  );
  assert(
    find<HTMLButtonElement>("#loading").disabled &&
      find("#loading").getAttribute("aria-busy") === "true",
    "Loading must disable button",
  );
  assert(
    find("#small").getBoundingClientRect().height === 28 &&
      find("#medium").getBoundingClientRect().height === 36,
    "Control sizes must be 28/36px",
  );
  await click("#switch");
  assert(find("#switch").getAttribute("aria-checked") === "true", "Switch state must update");
  results.push("PASS labels, error association, loading, sizes and switch state");
  document.documentElement.dataset.theme = "light";
  const light = getComputedStyle(find("#title")).backgroundColor;
  document.documentElement.dataset.theme = "dark";
  const dark = getComputedStyle(find("#title")).backgroundColor;
  assert(light !== dark, "Theme must reach public controls");
  document.documentElement.dataset.theme = "system";
  results.push("PASS live theme tokens");
  await click("#dialog-trigger");
  assert(container.querySelectorAll('[role="dialog"]').length === 1, "Dialog must open");
  await click("#nested-trigger");
  await settle();
  assert(container.querySelectorAll('[role="dialog"]').length === 2, "Nested popover must open");
  await escape();
  assert(
    container.querySelectorAll('[role="dialog"]').length === 1,
    "Escape must close only inner overlay",
  );
  assert(document.activeElement === find("#nested-trigger"), "Nested focus must restore");
  await escape();
  assert(!container.querySelector('[role="dialog"]'), "Dialog must close");
  assert(document.activeElement === find("#dialog-trigger"), "Dialog focus must restore");
  results.push("PASS nested Escape and focus restoration");
  await click("#toast-trigger");
  assert(container.querySelector(".m-toast"), "Page toast must appear");
  await click("#popover-trigger");
  await render(false);
  assert(
    !container.querySelector('[role="dialog"]') && !document.activeElement?.closest("[hidden]"),
    "Hidden retained page must release overlay and focus",
  );
  await render(true);
  await settle();
  assert(!container.querySelector('[role="dialog"]'), "Showing page must not reopen overlay");
  assert(!container.querySelector(".m-toast"), "Showing page must not restore old toasts");
  results.push("PASS retained-page hide, toast cleanup and reshow");
  await click("#dialog-trigger");
  await act(async () => {
    root.unmount();
  });
  assert(
    !document.querySelector('[role="dialog"]') && !document.body.style.pointerEvents,
    "Unmount must release modal resources",
  );
  const outside = document.createElement("button");
  document.body.append(outside);
  outside.focus();
  assert(document.activeElement === outside, "Unmount must release focus trap");
  outside.remove();
  results.push("PASS unmount cleanup");
  document.getElementById("results")!.textContent = results.join("\n");
  document.documentElement.dataset.result = "pass";
}
void run().catch((error) => {
  document.getElementById("results")!.textContent = [...results, String(error)].join("\n");
  document.documentElement.dataset.result = "fail";
});
