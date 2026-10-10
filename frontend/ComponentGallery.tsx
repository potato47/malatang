import React, { useState } from "react";
import * as UI from "@semicoder/malatang-sdk/ui";
function ToastDemo() {
  const toast = UI.useToast();
  return (
    <UI.Button
      variant="secondary"
      onClick={() => toast.add({ title: "已保存", description: "通知随所属页面关闭。" })}
    >
      显示通知
    </UI.Button>
  );
}
export default function ComponentGallery() {
  const [checked, setChecked] = useState(false),
    [visible, setVisible] = useState(true);
  const [option, setOption] = useState<string | null>("A");
  return (
    <UI.Page>
      <UI.PageHeader
        title="基础组件"
        description="公共 SDK 组件。检查明暗主题、键盘导航、状态及页面生命周期。"
      />
      <div className="gallery-stack">
        <UI.Panel>
          <UI.PanelHeader>按钮与反馈</UI.PanelHeader>
          <UI.PanelContent>
            <div className="gallery-row">
              {(["primary", "secondary", "ghost", "danger"] as const).map((variant) =>
                (["sm", "md", "lg"] as const).map((size) => (
                  <UI.Button key={`${variant}-${size}`} variant={variant} size={size}>
                    {variant} {size}
                  </UI.Button>
                )),
              )}
              <UI.Button disabled>禁用</UI.Button>
              <UI.Button loading>保存中</UI.Button>
              <UI.Tooltip>
                <UI.TooltipTrigger
                  render={
                    <UI.IconButton label="添加">
                      <UI.Plus />
                    </UI.IconButton>
                  }
                />
                <UI.TooltipContent>添加项目</UI.TooltipContent>
              </UI.Tooltip>
              <UI.Loading />
              <UI.Avatar alt="示例用户" fallback="U" />
              <UI.Kbd>⌘ Enter</UI.Kbd>
            </div>
          </UI.PanelContent>
          <UI.PanelFooter>
            {(["neutral", "success", "warning", "error"] as const).map((tone) => (
              <UI.Badge key={tone} tone={tone}>
                {tone}
              </UI.Badge>
            ))}
          </UI.PanelFooter>
        </UI.Panel>
        <UI.Panel>
          <UI.PanelHeader>表单</UI.PanelHeader>
          <UI.PanelContent>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <UI.Field label="显示名称" hint="点击标签聚焦输入框">
                  <UI.Input placeholder="请输入名称" />
                </UI.Field>
                <UI.Field label="搜索">
                  <UI.SearchInput placeholder="查找内容" />
                </UI.Field>
                <UI.Field label="错误输入" error="请填写有效内容">
                  <UI.Input defaultValue="?" />
                </UI.Field>
                <UI.Field label="禁用输入">
                  <UI.Input disabled />
                </UI.Field>
                <UI.Field label="多行内容">
                  <UI.Textarea />
                </UI.Field>
                <div className="gallery-row">
                  <label>
                    <UI.Checkbox checked={checked} onCheckedChange={setChecked} /> 同意示例
                  </label>
                  <UI.Switch aria-label="自动保存" checked={checked} onCheckedChange={setChecked} />
                </div>
              </div>
              <div>
                <UI.Field label="选择">
                  <UI.Select value={option} onValueChange={setOption}>
                    <UI.SelectTrigger />
                    <UI.SelectContent>
                      <UI.SelectItem value="A">选项 A</UI.SelectItem>
                      <UI.SelectItem value="B">选项 B</UI.SelectItem>
                      <UI.SelectItem value="C" disabled>
                        禁用选项
                      </UI.SelectItem>
                    </UI.SelectContent>
                  </UI.Select>
                </UI.Field>
                <UI.Field label="搜索选择">
                  <UI.Combobox items={["Apple", "Banana", "Cherry"]}>
                    <UI.ComboboxInput placeholder="搜索水果" />
                    <UI.ComboboxContent>
                      <UI.ComboboxEmpty>没有结果</UI.ComboboxEmpty>
                      <UI.ComboboxList>
                        {(item: string) => (
                          <UI.ComboboxItem key={item} value={item}>
                            {item}
                          </UI.ComboboxItem>
                        )}
                      </UI.ComboboxList>
                    </UI.ComboboxContent>
                  </UI.Combobox>
                </UI.Field>
                <UI.Field label="数量">
                  <UI.NumberField min={0} max={10} defaultValue={2} />
                </UI.Field>
                <UI.Field label="音量">
                  <UI.Slider aria-label="音量" defaultValue={40} />
                </UI.Field>
                <UI.RadioGroup aria-label="密度" defaultValue="normal">
                  <label>
                    <UI.Radio value="normal" />
                    舒适
                  </label>
                  <label>
                    <UI.Radio value="compact" />
                    紧凑
                  </label>
                </UI.RadioGroup>
              </div>
            </div>
          </UI.PanelContent>
        </UI.Panel>
        <UI.Panel>
          <UI.PanelHeader>浮层与页面生命周期</UI.PanelHeader>
          <UI.PanelContent>
            <div className="gallery-row">
              <UI.Menu>
                <UI.MenuTrigger render={<UI.Button>菜单</UI.Button>} />
                <UI.MenuContent>
                  <UI.MenuGroup>
                    <UI.MenuGroupLabel>操作</UI.MenuGroupLabel>
                    <UI.MenuItem>复制</UI.MenuItem>
                    <UI.MenuItem disabled>不可用选项</UI.MenuItem>
                  </UI.MenuGroup>
                  <UI.MenuSeparator />
                  <UI.MenuCheckboxItem checked={checked} onCheckedChange={setChecked}>
                    自动保存
                  </UI.MenuCheckboxItem>
                  <UI.MenuRadioGroup value={option} onValueChange={setOption}>
                    <UI.MenuRadioItem value="A">选项 A</UI.MenuRadioItem>
                    <UI.MenuRadioItem value="B">选项 B</UI.MenuRadioItem>
                  </UI.MenuRadioGroup>
                  <UI.MenuSubmenu>
                    <UI.MenuSubmenuTrigger>更多</UI.MenuSubmenuTrigger>
                    <UI.MenuContent side="right">
                      <UI.MenuItem>子菜单操作</UI.MenuItem>
                    </UI.MenuContent>
                  </UI.MenuSubmenu>
                </UI.MenuContent>
              </UI.Menu>
              <UI.Popover>
                <UI.PopoverTrigger render={<UI.Button variant="secondary">浮层</UI.Button>} />
                <UI.PopoverContent>
                  <UI.Field label="浮层输入">
                    <UI.Input />
                  </UI.Field>
                </UI.PopoverContent>
              </UI.Popover>
              <UI.Dialog>
                <UI.DialogTrigger render={<UI.Button>打开对话框</UI.Button>} />
                <UI.DialogContent>
                  <UI.DialogTitle>嵌套弹层</UI.DialogTitle>
                  <UI.DialogDescription>
                    Tab 保持在对话框内，Escape 先关闭最内层。
                  </UI.DialogDescription>
                  <UI.Field label="对话框输入">
                    <UI.Input />
                  </UI.Field>
                  <UI.Popover>
                    <UI.PopoverTrigger
                      render={<UI.Button variant="secondary">嵌套浮层</UI.Button>}
                    />
                    <UI.PopoverContent>
                      <UI.Field label="嵌套输入">
                        <UI.Input />
                      </UI.Field>
                    </UI.PopoverContent>
                  </UI.Popover>
                  <UI.DialogFooter>
                    <UI.DialogClose render={<UI.Button variant="secondary" />}>关闭</UI.DialogClose>
                  </UI.DialogFooter>
                </UI.DialogContent>
              </UI.Dialog>
              <UI.AlertDialog>
                <UI.AlertDialogTrigger render={<UI.Button variant="danger">危险操作</UI.Button>} />
                <UI.AlertDialogContent>
                  <UI.AlertDialogTitle>确认删除？</UI.AlertDialogTitle>
                  <UI.AlertDialogDescription>
                    这只是组件演示，不会删除数据。
                  </UI.AlertDialogDescription>
                  <UI.AlertDialogFooter>
                    <UI.AlertDialogClose render={<UI.Button variant="secondary" />}>
                      取消
                    </UI.AlertDialogClose>
                    <UI.AlertDialogClose render={<UI.Button variant="danger" />}>
                      确认
                    </UI.AlertDialogClose>
                  </UI.AlertDialogFooter>
                </UI.AlertDialogContent>
              </UI.AlertDialog>
              <ToastDemo />
              <UI.Button variant="secondary" onClick={() => setVisible((value) => !value)}>
                切换保留页面
              </UI.Button>
            </div>
            <UI.ContextMenu>
              <UI.ContextMenuTrigger className="mt-4 rounded-xl border border-border p-4 text-muted">
                在这里右键打开菜单
              </UI.ContextMenuTrigger>
              <UI.ContextMenuContent>
                <UI.MenuItem>上下文操作</UI.MenuItem>
              </UI.ContextMenuContent>
            </UI.ContextMenu>
            <UI.UIProvider visible={visible}>
              <div hidden={!visible} className="mt-4">
                <UI.Popover>
                  <UI.PopoverTrigger render={<UI.Button variant="ghost">保留页面浮层</UI.Button>} />
                  <UI.PopoverContent>
                    <UI.Button onClick={() => setVisible(false)}>隐藏所属页面</UI.Button>
                  </UI.PopoverContent>
                </UI.Popover>
                <ToastDemo />
              </div>
            </UI.UIProvider>
          </UI.PanelContent>
        </UI.Panel>
        <UI.SettingsGroup title="设置分组">
          <UI.SettingsRow label="自动保存" description="展示设置行的描述、控件和分隔。">
            <UI.Switch checked={checked} onCheckedChange={setChecked} aria-label="设置自动保存" />
          </UI.SettingsRow>
          <UI.SettingsRow label="进度">
            <UI.Badge>40%</UI.Badge>
          </UI.SettingsRow>
        </UI.SettingsGroup>
        <UI.Tabs defaultValue="overview">
          <UI.TabsList>
            <UI.TabsTrigger value="overview">概览</UI.TabsTrigger>
            <UI.TabsTrigger value="details">详情</UI.TabsTrigger>
            <UI.TabsTrigger value="disabled" disabled>
              禁用
            </UI.TabsTrigger>
          </UI.TabsList>
          <UI.TabsContent value="overview">
            <UI.Progress value={40} aria-label="下载进度" />
            <UI.Separator />
            <UI.Skeleton className="h-10 w-1/2" />
          </UI.TabsContent>
          <UI.TabsContent value="details">
            <UI.ScrollArea className="h-40">
              {Array.from({ length: 20 }, (_, i) => (
                <p key={i}>滚动内容 {i + 1}</p>
              ))}
            </UI.ScrollArea>
          </UI.TabsContent>
        </UI.Tabs>
        <UI.Accordion>
          <UI.AccordionItem value="details">
            <UI.AccordionTrigger>组件使用说明</UI.AccordionTrigger>
            <UI.AccordionContent>组合式 API，统一主题与键盘交互。</UI.AccordionContent>
          </UI.AccordionItem>
        </UI.Accordion>
        {(["neutral", "success", "warning", "error"] as const).map((tone) => (
          <UI.Alert key={tone} tone={tone}>
            {tone} 状态提示
          </UI.Alert>
        ))}
        <UI.EmptyState title="尚无内容" description="公共空状态组件" />
      </div>
    </UI.Page>
  );
}
