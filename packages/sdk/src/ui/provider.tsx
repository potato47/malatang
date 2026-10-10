import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Toast as BaseToast } from "@base-ui/react/toast";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { styled } from "./utils";
import type { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
const PageContext = createContext<{
  visible: boolean;
  portal: HTMLDivElement | null;
  pluginId?: string;
}>({ visible: true, portal: null });
export const useScope = () => useContext(PageContext);
export function UIProvider({
  visible = true,
  pluginId,
  children,
}: {
  visible?: boolean;
  pluginId?: string;
  children: ReactNode;
}) {
  const parent = useScope();
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const active = parent.visible && visible;
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (
      !active &&
      document.activeElement instanceof HTMLElement &&
      container.current?.contains(document.activeElement)
    )
      document.activeElement.blur();
  }, [active]);
  return (
    <PageContext.Provider
      value={{ visible: active, portal, pluginId: pluginId ?? parent.pluginId }}
    >
      <BaseTooltip.Provider delay={400}>
        <BaseToast.Provider>
          <div ref={container} data-plugin-scope={pluginId} className="m-ui-scope">
            {children}
            <div
              ref={setPortal}
              className="m-portals"
              data-plugin-scope={pluginId ?? parent.pluginId}
            />
          </div>
          <ToastViewport />
        </BaseToast.Provider>
      </BaseTooltip.Provider>
    </PageContext.Provider>
  );
}
export function useOverlay(
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
  defaultOpen = false,
  suppliedActions?: RefObject<{ unmount: () => void; close: () => void } | null>,
) {
  const ownActions = useRef<{ unmount: () => void; close: () => void } | null>(null);
  const actionsRef = suppliedActions ?? ownActions;
  const scope = useScope();
  const [local, setLocal] = useState(defaultOpen);
  const active = useRef(scope.visible);
  active.current = scope.visible;
  const callback = useRef(onOpenChange);
  callback.current = onOpenChange;
  const change = (value: boolean) => {
    setLocal(value);
    callback.current?.(value);
  };
  useEffect(() => {
    if (!scope.visible && (open ?? local)) change(false);
  }, [scope.visible, open, local]);
  // Hidden pages remove their Portal immediately, so explicitly finish Base UI
  // unmounting instead of waiting for an animation on the detached popup.
  useLayoutEffect(() => {
    if (!scope.visible) actionsRef.current?.unmount();
  }, [scope.visible, actionsRef]);
  return {
    scope,
    actionsRef,
    open: scope.visible && (open ?? local),
    change,
    finalFocus: () => active.current,
  };
}
export const useToast = BaseToast.useToastManager;
export const Toast = styled(BaseToast.Root, "m-toast");
function ToastViewport() {
  const scope = useScope();
  const { toasts, close } = useToast();
  useEffect(() => {
    if (!scope.visible)
      toasts
        .filter((toast) => toast.transitionStatus !== "ending")
        .forEach((toast) => close(toast.id));
  }, [scope.visible, toasts, close]);
  if (!scope.visible || !scope.portal) return null;
  return (
    <BaseToast.Portal container={scope.portal}>
      <BaseToast.Viewport className="m-toast-viewport">
        {toasts.map((toast) => (
          <BaseToast.Root key={toast.id} toast={toast} className="m-toast">
            <BaseToast.Content>
              <BaseToast.Title className="m-toast-title" />
              <BaseToast.Description className="m-description" />
            </BaseToast.Content>
            <BaseToast.Close className="m-toast-close" aria-label="关闭通知">
              <X size={16} />
            </BaseToast.Close>
          </BaseToast.Root>
        ))}
      </BaseToast.Viewport>
    </BaseToast.Portal>
  );
}

export function useFinalFocus(finalFocus?: BaseDialog.Popup.Props["finalFocus"]) {
  const scope = useScope();
  const visible = useRef(scope.visible);
  visible.current = scope.visible;
  const focus: Extract<BaseDialog.Popup.Props["finalFocus"], Function> = (interaction) => {
    if (!visible.current) return false;
    if (typeof finalFocus === "function") return finalFocus(interaction);
    if (typeof finalFocus === "object") return finalFocus.current;
    return finalFocus ?? true;
  };
  return focus;
}
