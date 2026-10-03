import React, { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title" | "aria-label"> & {
  label: string;
  tooltipDisabled?: boolean;
};

export default forwardRef<HTMLButtonElement, Props>(function ActivityButton({ label, tooltipDisabled = false, children, ...props }, ref) {
  const button = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const id = useId();
  const visible = open && !tooltipDisabled;
  useImperativeHandle(ref, () => button.current!, []);

  const cancelTimer = useCallback(() => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; }, []);
  const hide = useCallback(() => { cancelTimer(); setOpen(false); }, [cancelTimer]);
  const show = (immediate = false) => {
    cancelTimer();
    if (tooltipDisabled || props.disabled) return;
    if (immediate) setOpen(true);
    else timer.current = setTimeout(() => setOpen(true), 300);
  };
  const leave = () => { cancelTimer(); timer.current = setTimeout(() => setOpen(false), 100); };
  useEffect(() => cancelTimer, [cancelTimer]);
  useEffect(() => { if (tooltipDisabled) hide(); }, [tooltipDisabled, hide]);
  useLayoutEffect(() => {
    if (!visible || !button.current || !tooltip.current) return;
    const anchor = button.current.getBoundingClientRect();
    const bubble = tooltip.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(anchor.right + 10, window.innerWidth - bubble.width - 8)),
      top: Math.max(8, Math.min(anchor.top + (anchor.height - bubble.height) / 2, window.innerHeight - bubble.height - 8)),
    });
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    const otherButton = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest(".activity-button") : null;
      if (target && target !== button.current) hide();
    };
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("pointerover", otherButton, true);
    return () => {
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("pointerover", otherButton, true);
    };
  }, [visible, label, hide]);

  return <>
    <button {...props} ref={button} aria-label={label} aria-describedby={visible ? id : undefined}
      onPointerEnter={event => { props.onPointerEnter?.(event); if (event.pointerType !== "touch") show(); }}
      onPointerLeave={event => { props.onPointerLeave?.(event); leave(); }}
      onFocus={event => { props.onFocus?.(event); if (event.currentTarget.matches(":focus-visible")) show(true); }}
      onBlur={event => { props.onBlur?.(event); hide(); }}
      onPointerDown={event => { props.onPointerDown?.(event); hide(); }}
      onClick={event => { hide(); props.onClick?.(event); }}>
      {children}
    </button>
    {visible && createPortal(<div ref={tooltip} id={id} role="tooltip" className="activity-tooltip" style={position}
      onPointerEnter={cancelTimer} onPointerLeave={hide}>{label}</div>, document.body)}
  </>;
});
