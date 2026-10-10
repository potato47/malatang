import React, { type ComponentProps } from "react";
import { Check, ChevronRight } from "lucide-react";
import { styled, cx } from "./utils";
import { useOverlay, useScope, useFinalFocus } from "./provider";
import { Dialog as D } from "@base-ui/react/dialog";
import { AlertDialog as A } from "@base-ui/react/alert-dialog";
import { Popover as P } from "@base-ui/react/popover";
import { Menu as M } from "@base-ui/react/menu";
import { ContextMenu as C } from "@base-ui/react/context-menu";
import { Tooltip as T } from "@base-ui/react/tooltip";

type Public<P> = Omit<P, "className"> & { className?: string };
function usePopup(finalFocus?: ComponentProps<typeof D.Popup>["finalFocus"]) {
  const scope = useScope();
  return { ...scope, finalFocus: useFinalFocus(finalFocus) };
}
export function Dialog({
  open,
  onOpenChange,
  defaultOpen,
  ...props
}: Omit<ComponentProps<typeof D.Root>, "onOpenChange"> & {
  onOpenChange?: (open: boolean) => void;
}) {
  const state = useOverlay(open, onOpenChange, defaultOpen, props.actionsRef);
  return (
    <D.Root
      {...props}
      actionsRef={state.actionsRef}
      open={state.open}
      onOpenChange={state.change}
    />
  );
}
export const DialogTrigger = styled(D.Trigger, "m-trigger");
export const DialogTitle = styled(D.Title, "m-dialog-title");
export const DialogDescription = styled(D.Description, "m-description");
export const DialogClose = styled(D.Close, "");
export function DialogContent({ className, ...props }: Public<ComponentProps<typeof D.Popup>>) {
  const scope = usePopup("finalFocus" in props ? props.finalFocus : undefined);
  if (!scope.visible || !scope.portal) return null;
  return (
    <D.Portal container={scope.portal}>
      <D.Backdrop className="m-dialog-overlay" />
      <D.Popup {...props} finalFocus={scope.finalFocus} className={cx("m-dialog", className)} />
    </D.Portal>
  );
}
export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cx("m-dialog-footer", className)} />;
}
export function AlertDialog({
  open,
  onOpenChange,
  defaultOpen,
  ...props
}: Omit<ComponentProps<typeof A.Root>, "onOpenChange"> & {
  onOpenChange?: (open: boolean) => void;
}) {
  const state = useOverlay(open, onOpenChange, defaultOpen, props.actionsRef);
  return (
    <A.Root
      {...props}
      actionsRef={state.actionsRef}
      open={state.open}
      onOpenChange={state.change}
    />
  );
}
export const AlertDialogTrigger = styled(A.Trigger, "m-trigger");
export const AlertDialogTitle = styled(A.Title, "m-dialog-title");
export const AlertDialogDescription = styled(A.Description, "m-description");
export const AlertDialogClose = styled(A.Close, "");
export function AlertDialogContent({
  className,
  ...props
}: Public<ComponentProps<typeof A.Popup>>) {
  const scope = usePopup("finalFocus" in props ? props.finalFocus : undefined);
  if (!scope.visible || !scope.portal) return null;
  return (
    <A.Portal container={scope.portal}>
      <A.Backdrop className="m-dialog-overlay" />
      <A.Popup {...props} finalFocus={scope.finalFocus} className={cx("m-dialog", className)} />
    </A.Portal>
  );
}
export function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cx("m-dialog-footer", className)} />;
}
export function Popover({
  open,
  onOpenChange,
  defaultOpen,
  ...props
}: Omit<ComponentProps<typeof P.Root>, "onOpenChange"> & {
  onOpenChange?: (open: boolean) => void;
}) {
  const state = useOverlay(open, onOpenChange, defaultOpen, props.actionsRef);
  return (
    <P.Root
      {...props}
      actionsRef={state.actionsRef}
      open={state.open}
      onOpenChange={state.change}
    />
  );
}
export const PopoverTrigger = styled(P.Trigger, "m-trigger");
export function PopoverContent({
  className,
  side = "bottom",
  align = "start",
  sideOffset = 6,
  collisionPadding = 12,
  ...props
}: Public<ComponentProps<typeof P.Popup>> &
  Pick<ComponentProps<typeof P.Positioner>, "side" | "align" | "sideOffset" | "collisionPadding">) {
  const scope = usePopup("finalFocus" in props ? props.finalFocus : undefined);
  if (!scope.visible || !scope.portal) return null;
  return (
    <P.Portal container={scope.portal}>
      <P.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className="m-positioner"
      >
        <P.Popup {...props} finalFocus={scope.finalFocus} className={cx("m-popover", className)} />
      </P.Positioner>
    </P.Portal>
  );
}
export function Menu({
  open,
  onOpenChange,
  defaultOpen,
  ...props
}: Omit<ComponentProps<typeof M.Root>, "onOpenChange"> & {
  onOpenChange?: (open: boolean) => void;
}) {
  const state = useOverlay(open, onOpenChange, defaultOpen, props.actionsRef);
  return (
    <M.Root
      {...props}
      actionsRef={state.actionsRef}
      open={state.open}
      onOpenChange={state.change}
    />
  );
}
export const MenuTrigger = styled(M.Trigger, "m-trigger");
export function MenuContent({
  className,
  side = "bottom",
  align = "start",
  sideOffset = 6,
  collisionPadding = 12,
  ...props
}: Public<ComponentProps<typeof M.Popup>> &
  Pick<ComponentProps<typeof M.Positioner>, "side" | "align" | "sideOffset" | "collisionPadding">) {
  const scope = usePopup("finalFocus" in props ? props.finalFocus : undefined);
  if (!scope.visible || !scope.portal) return null;
  return (
    <M.Portal container={scope.portal}>
      <M.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className="m-positioner"
      >
        <M.Popup {...props} finalFocus={scope.finalFocus} className={cx("m-menu", className)} />
      </M.Positioner>
    </M.Portal>
  );
}
export function ContextMenu({
  open,
  onOpenChange,
  defaultOpen,
  ...props
}: Omit<ComponentProps<typeof C.Root>, "onOpenChange"> & {
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
export const ContextMenuTrigger = styled(C.Trigger, "m-trigger");
export function ContextMenuContent({
  className,
  side = "bottom",
  align = "start",
  sideOffset = 6,
  collisionPadding = 12,
  ...props
}: Public<ComponentProps<typeof C.Popup>> &
  Pick<ComponentProps<typeof C.Positioner>, "side" | "align" | "sideOffset" | "collisionPadding">) {
  const scope = usePopup("finalFocus" in props ? props.finalFocus : undefined);
  if (!scope.visible || !scope.portal) return null;
  return (
    <C.Portal container={scope.portal}>
      <C.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className="m-positioner"
      >
        <C.Popup {...props} finalFocus={scope.finalFocus} className={cx("m-menu", className)} />
      </C.Positioner>
    </C.Portal>
  );
}
export function Tooltip({
  open,
  onOpenChange,
  defaultOpen,
  ...props
}: Omit<ComponentProps<typeof T.Root>, "onOpenChange"> & {
  onOpenChange?: (open: boolean) => void;
}) {
  const state = useOverlay(open, onOpenChange, defaultOpen, props.actionsRef);
  return (
    <T.Root
      {...props}
      actionsRef={state.actionsRef}
      open={state.open}
      onOpenChange={state.change}
    />
  );
}
export const TooltipTrigger = styled(T.Trigger, "m-trigger");
export function TooltipContent({
  className,
  side = "right",
  align = "start",
  sideOffset = 6,
  collisionPadding = 12,
  ...props
}: Public<ComponentProps<typeof T.Popup>> &
  Pick<ComponentProps<typeof T.Positioner>, "side" | "align" | "sideOffset" | "collisionPadding">) {
  const scope = usePopup();
  if (!scope.visible || !scope.portal) return null;
  return (
    <T.Portal container={scope.portal}>
      <T.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className="m-positioner"
      >
        <T.Popup {...props} className={cx("m-tooltip", className)} />
      </T.Positioner>
    </T.Portal>
  );
}

export const PopoverClose = styled(P.Close, "");
export const PopoverTitle = styled(P.Title, "m-dialog-title");
export const PopoverDescription = styled(P.Description, "m-description");
export const MenuItem = styled(M.Item, "m-menu-item");
export const MenuGroup = M.Group;
export const MenuGroupLabel = styled(M.GroupLabel, "m-menu-label");
export const MenuSeparator = styled(M.Separator, "m-separator");
export const MenuRadioGroup = M.RadioGroup;
export const MenuSubmenu = M.SubmenuRoot;
export function MenuSubmenuTrigger({
  children,
  className,
  ...props
}: Public<ComponentProps<typeof M.SubmenuTrigger>>) {
  return (
    <M.SubmenuTrigger {...props} className={cx("m-menu-item", className)}>
      {children}
      <ChevronRight size={16} className="m-trailing" />
    </M.SubmenuTrigger>
  );
}
export function MenuCheckboxItem({
  children,
  className,
  ...props
}: Public<ComponentProps<typeof M.CheckboxItem>>) {
  return (
    <M.CheckboxItem {...props} className={cx("m-menu-item", className)}>
      {children}
      <M.CheckboxItemIndicator className="m-trailing">
        <Check size={16} />
      </M.CheckboxItemIndicator>
    </M.CheckboxItem>
  );
}
export function MenuRadioItem({
  children,
  className,
  ...props
}: Public<ComponentProps<typeof M.RadioItem>>) {
  return (
    <M.RadioItem {...props} className={cx("m-menu-item", className)}>
      {children}
      <M.RadioItemIndicator className="m-trailing">
        <Check size={16} />
      </M.RadioItemIndicator>
    </M.RadioItem>
  );
}
