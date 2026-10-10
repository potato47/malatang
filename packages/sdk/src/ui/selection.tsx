import React, { type ComponentProps } from "react";
import { Select as S } from "@base-ui/react/select";
import { Combobox as C } from "@base-ui/react/combobox";
import { Check, ChevronDown } from "lucide-react";
import { useControl, type Size } from "./basic";
import { useOverlay, useScope, useFinalFocus } from "./provider";
import { cx, styled } from "./utils";
type Public<P> = Omit<P, "className"> & { className?: string };
export function Select<Value, Multiple extends boolean | undefined = false>({
  open,
  onOpenChange,
  defaultOpen,
  ...props
}: Omit<S.Root.Props<Value, Multiple>, "onOpenChange"> & {
  onOpenChange?: (open: boolean) => void;
}) {
  const state = useOverlay(open, onOpenChange, defaultOpen, props.actionsRef);
  return (
    <S.Root
      {...props}
      items={props.items ?? selectLabels(props.children)}
      actionsRef={state.actionsRef}
      open={state.open}
      onOpenChange={state.change}
    />
  );
}
export function SelectTrigger({
  className,
  size = "md",
  children,
  ...props
}: Public<ComponentProps<typeof S.Trigger>> & { size?: Size }) {
  return (
    <S.Trigger {...props} {...useControl(props)} className={cx("m-select", `m-${size}`, className)}>
      {children ?? <S.Value placeholder="请选择" />}
      <S.Icon>
        <ChevronDown size={16} />
      </S.Icon>
    </S.Trigger>
  );
}
export const SelectValue = S.Value;
export const SelectGroup = S.Group;
export const SelectGroupLabel = styled(S.GroupLabel, "m-menu-label");
export function SelectContent({
  className,
  children,
  ...props
}: Public<ComponentProps<typeof S.Popup>>) {
  const scope = useScope();
  const finalFocus = useFinalFocus(props.finalFocus);
  if (!scope.visible || !scope.portal) return null;
  return (
    <S.Portal container={scope.portal}>
      <S.Positioner
        sideOffset={6}
        alignItemWithTrigger={false}
        collisionPadding={12}
        className="m-positioner"
      >
        <S.Popup
          {...props}
          finalFocus={finalFocus}
          className={cx("m-menu m-select-popup", className)}
        >
          <S.List>{children}</S.List>
        </S.Popup>
      </S.Positioner>
    </S.Portal>
  );
}
export function SelectItem({
  children,
  className,
  ...props
}: Public<ComponentProps<typeof S.Item>>) {
  return (
    <S.Item {...props} className={cx("m-menu-item", className)}>
      <S.ItemText>{children}</S.ItemText>
      <S.ItemIndicator className="m-trailing">
        <Check size={16} />
      </S.ItemIndicator>
    </S.Item>
  );
}
export function Combobox<Value, Multiple extends boolean | undefined = false, Item = Value>({
  open,
  onOpenChange,
  defaultOpen,
  ...props
}: Omit<C.Root.Props<Value, Multiple, Item>, "onOpenChange"> & {
  onOpenChange?: (open: boolean) => void;
}) {
  const state = useOverlay(open, onOpenChange, defaultOpen, props.actionsRef);
  return (
    <C.Root
      {...props}
      actionsRef={state.actionsRef}
      open={state.open}
      onOpenChange={state.change}
    />
  );
}
export function ComboboxInput({ className, ...props }: Public<ComponentProps<typeof C.Input>>) {
  return <C.Input {...props} {...useControl(props)} className={cx("m-input m-md", className)} />;
}
export function ComboboxTrigger({ className, ...props }: Public<ComponentProps<typeof C.Trigger>>) {
  return <C.Trigger {...props} {...useControl(props)} className={cx("m-select m-md", className)} />;
}
export const ComboboxValue = C.Value;
export const ComboboxGroup = C.Group;
export const ComboboxGroupLabel = styled(C.GroupLabel, "m-menu-label");
export const ComboboxCollection = C.Collection;
export const ComboboxList = styled(C.List, "m-combobox-list");
export const ComboboxEmpty = styled(C.Empty, "m-menu-empty");
export function ComboboxContent({ className, ...props }: Public<ComponentProps<typeof C.Popup>>) {
  const scope = useScope();
  const finalFocus = useFinalFocus(props.finalFocus);
  if (!scope.visible || !scope.portal) return null;
  return (
    <C.Portal container={scope.portal}>
      <C.Positioner sideOffset={6} collisionPadding={12} className="m-positioner">
        <C.Popup
          {...props}
          finalFocus={finalFocus}
          className={cx("m-menu m-combobox-popup", className)}
        />
      </C.Positioner>
    </C.Portal>
  );
}
export function ComboboxItem({
  children,
  className,
  ...props
}: Public<ComponentProps<typeof C.Item>>) {
  return (
    <C.Item {...props} className={cx("m-menu-item", className)}>
      {children}
      <C.ItemIndicator className="m-trailing">
        <Check size={16} />
      </C.ItemIndicator>
    </C.Item>
  );
}

function selectLabels(children: React.ReactNode): { value: unknown; label: React.ReactNode }[] {
  return React.Children.toArray(children).flatMap((child) => {
    if (!React.isValidElement<{ value?: unknown; children?: React.ReactNode }>(child)) return [];
    return child.type === SelectItem
      ? [{ value: child.props.value, label: child.props.children }]
      : selectLabels(child.props.children);
  });
}
