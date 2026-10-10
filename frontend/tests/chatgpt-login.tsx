import { UIProvider } from "@semicoder/malatang-sdk/ui";
import "../tailwind.css";
// Run on the existing FIA development server; all account operations below are local fixtures.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ChatGPTConnection from "../ChatGPTConnection";
import { app } from "../bridge";
import type { ChatGPTStatus } from "../../shared/chatgpt";
import "../style.css";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
app.close();
const profile = (id: string) => ({
  id,
  label: id,
  email: null,
  connected: false,
  sharing: false,
  welcomeSeen: false,
  incomplete: true,
  removalBlockedReason: null,
});
const base: ChatGPTStatus = {
  available: true,
  activeProfileId: null,
  profiles: [profile("registration-a")],
  attempt: null,
  message: "",
};
let status = base;
let failWrite = false;
const calls: { method: string; input: unknown }[] = [];
Object.assign(app, {
  call: async (method: string, input: unknown) => {
    if (method === "chatgpt.status") return structuredClone(status);
    const params = input as {
      profileId?: string;
      id?: string;
      profileIds?: string[];
      label?: string;
    };
    if (method === "chatgpt.catalog") return [{ id: "fixture-model", name: "Fixture model" }];
    if (failWrite && ["chatgpt.rename", "chatgpt.remove"].includes(method))
      throw new Error("无法保存 ChatGPT 账号信息，请检查系统钥匙串后重试。");
    if (method === "chatgpt.signIn")
      status = {
        ...status,
        attempt: {
          id: "fixture-attempt",
          profileId: params.profileId ?? null,
          stage: "waiting",
          message: "请在浏览器中完成登录。",
        },
      };
    else if (method === "chatgpt.cancel" && params.id === status.attempt?.id)
      status = {
        ...status,
        attempt: { ...status.attempt!, stage: "cancelled", message: "已取消登录。" },
      };
    else if (method === "chatgpt.select")
      status = { ...status, activeProfileId: params.profileId! };
    else if (method === "chatgpt.rename")
      status = {
        ...status,
        profiles: status.profiles.map((p) =>
          p.id === params.profileId ? { ...p, label: params.label!.trim() } : p,
        ),
      };
    else if (method === "chatgpt.remove")
      status = {
        ...status,
        profiles: status.profiles.filter((p) => !params.profileIds!.includes(p.id)),
      };
    else throw new Error("Unexpected fixture call: " + method);
    calls.push({ method, input });
    return structuredClone(status);
  },
  on: () => () => {},
  onReconnect: () => () => {},
});
const accountSelect = () =>
  document.querySelector<HTMLButtonElement>('[aria-label="当前 ChatGPT 账号"]')!;
const root = createRoot(document.getElementById("fixture")!);
let generation = 0;
const results: string[] = [];
function activateOption(node: HTMLElement) {
  node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
  node.click();
}
function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;
async function render(next: ChatGPTStatus) {
  status = next;
  calls.length = 0;
  await act(async () => {
    root.render(
      <UIProvider>
        <ChatGPTConnection key={++generation} />
      </UIProvider>,
    );
  });
}
async function click(text: string) {
  await act(async () => {
    button(text).click();
  });
}
async function clickLabel(label: string) {
  await act(async () => {
    (document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click();
  });
}
async function changeName(value: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="账号名称"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function run() {
  await render(base);
  assert(
    accountSelect()?.textContent?.includes("registration-a"),
    "Restored registration must be selected for retry",
  );
  await click("Continue with ChatGPT");
  assert(
    (calls[0]?.input as { profileId: string }).profileId === "registration-a",
    "Continue must reuse the registration after restart",
  );
  assert(
    status.activeProfileId === null,
    "Displaying a registration must not activate an unverified account",
  );
  results.push("PASS restored registration, login target and unverified account isolation");

  await render({
    ...base,
    activeProfileId: "registration-b",
    profiles: [profile("registration-a"), profile("registration-b")],
    attempt: {
      id: "attempt",
      profileId: "registration-a",
      stage: "failed",
      message: "授权码交换失败：地区限制",
    },
  });
  assert(
    accountSelect()?.textContent?.includes("registration-b"),
    "Failed new login must preserve the current selection",
  );
  await click("重试此账号登录");
  assert(
    (calls[0]?.input as { profileId: string }).profileId === "registration-a",
    "Error retry must target the failed registration, not the current account",
  );
  results.push("PASS explicit retry targets failed additional account");

  await render({ ...base, profiles: [profile("registration-a"), profile("registration-b")] });
  assert(
    accountSelect()?.textContent?.includes("registration-b"),
    "Restart must select the latest saved registration",
  );
  assert(
    !button("Continue with ChatGPT").disabled,
    "Multiple unfinished logins must not disable Continue",
  );
  await click("Continue with ChatGPT");
  assert(
    (calls[0]?.input as { profileId: string }).profileId === "registration-b",
    "Continue must reuse the latest registration",
  );
  assert(status.activeProfileId === null, "Default login target must not activate an account");
  assert(
    button("取消登录") && accountSelect()?.disabled,
    "Starting login must show waiting state and lock the selector",
  );
  await click("取消登录");
  assert(
    !button("Continue with ChatGPT").disabled,
    "Cancelling login must restore a usable Continue button",
  );
  results.push("PASS multiple restored registrations, waiting and cancellation");

  await act(async () => {
    accountSelect().click();
  });
  await act(async () => {
    activateOption(
      [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) =>
        node.textContent?.includes("registration-a"),
      )!,
    );
  });
  await click("Continue with ChatGPT");
  assert(
    (calls.at(-1)?.input as { profileId: string }).profileId === "registration-a",
    "Manual selection must take precedence over the latest registration",
  );
  results.push("PASS manual account selection overrides default login target");

  await render({ ...base, profiles: [profile("registration-a"), profile("registration-b")] });
  await click("＋ 添加账号");
  assert(
    JSON.stringify(calls[0]?.input) === "{}",
    "Only explicit add-account starts a new registration",
  );
  results.push("PASS explicit add-account remains available");

  await render({ ...base, profiles: [] });
  assert(
    !button("Continue with ChatGPT").disabled,
    "First login must remain available without saved accounts",
  );
  await click("Continue with ChatGPT");
  assert(JSON.stringify(calls[0]?.input) === "{}", "First login must start registration");
  assert(button("取消登录"), "First login must show waiting state");
  results.push("PASS first login without existing accounts");

  const connected = {
    ...profile("connected"),
    connected: true,
    sharing: true,
    welcomeSeen: true,
    incomplete: false,
    removalBlockedReason: "请先退出此账号，再移除本地记录。",
  };
  const accounts = {
    ...base,
    activeProfileId: connected.id,
    profiles: [profile("failed-a"), profile("failed-b"), connected],
  };
  await render(accounts);
  await act(async () => {
    document.querySelector("summary")!.click();
  });
  await clickLabel("重命名 connected");
  await changeName("  工作账号  ");
  failWrite = true;
  await click("保存名称");
  assert(
    document.querySelector<HTMLInputElement>('[aria-label="账号名称"]')?.value === "  工作账号  ",
    "Failed rename must retain the draft",
  );
  assert(
    document.querySelector('[role="alert"]')?.textContent?.includes("钥匙串"),
    "Persistence errors must be visible",
  );
  failWrite = false;
  await click("保存名称");
  assert(!document.querySelector('[aria-label="账号名称"]'), "Successful rename closes the editor");
  assert(
    accountSelect()?.textContent?.includes("工作账号"),
    "Dropdown must immediately show the new label",
  );
  assert(status.activeProfileId === connected.id, "Renaming must preserve account selection");
  await clickLabel("重命名 工作账号");
  await changeName("   ");
  assert(button("保存名称").disabled, "Blank names must not be submitted");
  await click("取消修改");
  results.push("PASS rename, validation, persistence failure and selection preservation");

  assert(
    (document.querySelector('[aria-label="移除 工作账号"]') as HTMLButtonElement).disabled,
    "Connected account must be protected",
  );
  await click("清理未完成登录（2）");
  assert(status.profiles.length === 3, "Cleanup must wait for confirmation");
  await click("取消移除");
  assert(
    !document.querySelector('[aria-label="确认移除账号"]'),
    "Cancelling cleanup dismisses confirmation",
  );
  await clickLabel("移除 failed-a");
  await click("确认移除");
  assert(
    !status.profiles.some((p) => p.id === "failed-a"),
    "Single removal must target the requested record",
  );
  assert(
    status.activeProfileId === connected.id,
    "Single removal must not switch the connected account",
  );
  await click("清理未完成登录（1）");
  await click("确认移除");
  assert(
    Number(status.profiles.length) === 1 && status.profiles[0]?.id === connected.id,
    "Batch cleanup must preserve connected account",
  );
  assert(
    button("清理未完成登录").disabled,
    "Cleanup must disable when no incomplete records remain",
  );
  results.push(
    "PASS confirmation, cancellation, single and batch cleanup with connected account protection",
  );

  await render({
    ...base,
    profiles: [
      {
        ...profile("signed-out"),
        incomplete: false,
        removalBlockedReason: "此账号仍绑定 1 个模型，请先从模型列表移除。",
      },
      profile("failed"),
    ],
  });
  assert(
    (document.querySelector('[aria-label="移除 signed-out"]') as HTMLButtonElement).disabled,
    "Bound models must block removal",
  );
  await click("Continue with ChatGPT");
  assert(
    (document.querySelector('[aria-label="重命名 failed"]') as HTMLButtonElement).disabled,
    "Login must lock editing",
  );
  assert(button("清理未完成登录（1）").disabled, "Login must lock cleanup");
  results.push("PASS bound-model and pending-login guards");
  if (new URL(location.href).searchParams.has("preview")) {
    await render({
      ...base,
      activeProfileId: connected.id,
      profiles: [
        ...Array.from({ length: 4 }, (_, i) => ({
          ...profile(`failed-${i}`),
          label: `ChatGPT 账号 ${i + 1}`,
        })),
        { ...connected, label: "工作账号", email: "person@example.test" },
      ],
    });
    await act(async () => {
      document.querySelector("summary")!.click();
    });
    document.getElementById("fixture")!.style.cssText =
      "max-width:1000px;margin:30px auto;padding:0 20px";
    document.getElementById("results")!.hidden = true;
  } else
    await act(async () => {
      root.unmount();
    });
  document.getElementById("results")!.textContent = results.join("\n");
  document.documentElement.dataset.result = "pass";
}
void run().catch((error) => {
  document.getElementById("results")!.textContent = [...results, String(error)].join("\n");
  document.documentElement.dataset.result = "fail";
  console.error(error);
});
