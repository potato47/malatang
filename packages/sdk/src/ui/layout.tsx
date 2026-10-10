import React, { type ComponentProps } from "react";
import { Tabs as B } from "@base-ui/react/tabs";
import { Accordion as A } from "@base-ui/react/accordion";
import { ScrollArea as S } from "@base-ui/react/scroll-area";
import { Separator as BSeparator } from "@base-ui/react/separator";
import { Progress as P } from "@base-ui/react/progress";
import { Avatar as V } from "@base-ui/react/avatar";
import { ChevronDown } from "lucide-react";
import { styled, cx } from "./utils";
type Public<P> = Omit<P, "className"> & { className?: string };
export const Tabs = styled(B.Root, "m-tabs");
export const TabsList = styled(B.List, "m-tabs-list");
export const TabsTrigger = styled(B.Tab, "m-tabs-trigger");
export const TabsContent = styled(B.Panel, "m-tabs-content");
export const Accordion = styled(A.Root, "m-accordion");
export const AccordionItem = styled(A.Item, "m-accordion-item");
export function AccordionTrigger({
  children,
  className,
  ...props
}: Public<ComponentProps<typeof A.Trigger>>) {
  return (
    <A.Header>
      <A.Trigger {...props} className={cx("m-accordion-trigger", className)}>
        {children}
        <ChevronDown size={16} />
      </A.Trigger>
    </A.Header>
  );
}
export const AccordionContent = styled(A.Panel, "m-accordion-content");
export const Separator = styled(BSeparator, "m-separator");
export function ScrollArea({
  children,
  className,
  ...props
}: Public<ComponentProps<typeof S.Root>>) {
  return (
    <S.Root {...props} className={cx("m-scroll-area", className)}>
      <S.Viewport className="m-scroll-viewport">{children}</S.Viewport>
      <S.Scrollbar className="m-scrollbar">
        <S.Thumb className="m-scroll-thumb" />
      </S.Scrollbar>
      <S.Scrollbar orientation="horizontal" className="m-scrollbar">
        <S.Thumb className="m-scroll-thumb" />
      </S.Scrollbar>
      <S.Corner />
    </S.Root>
  );
}
export function Progress({ className, ...props }: Public<ComponentProps<typeof P.Root>>) {
  return (
    <P.Root {...props} className={cx("m-progress", className)}>
      <P.Track>
        <P.Indicator />
      </P.Track>
    </P.Root>
  );
}
export function Avatar({
  src,
  alt,
  fallback,
  className,
  ...props
}: Public<ComponentProps<typeof V.Root>> & {
  src?: string;
  alt: string;
  fallback: React.ReactNode;
}) {
  return (
    <V.Root {...props} className={cx("m-avatar", className)}>
      <V.Image src={src} alt={alt} />
      <V.Fallback aria-label={alt}>{fallback}</V.Fallback>
    </V.Root>
  );
}
