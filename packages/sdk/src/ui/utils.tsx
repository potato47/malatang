import React, { type ComponentType } from "react";
export const cx = (...values: (string | undefined | false)[]) => values.filter(Boolean).join(" ");
/** Preserve Base UI refs and render props, while reserving state styling for the SDK. */
export function styled<P extends { className?: unknown }>(
  Component: ComponentType<P>,
  base: string,
) {
  return function Styled({ className, ...props }: Omit<P, "className"> & { className?: string }) {
    return <Component {...({ ...props, className: cx(base, className) } as P)} />;
  };
}
