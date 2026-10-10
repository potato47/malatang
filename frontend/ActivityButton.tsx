import React from "react";
import { IconButton, Tooltip, TooltipTrigger, TooltipContent } from "@semicoder/malatang-sdk/ui";
type Props = Omit<React.ComponentProps<typeof IconButton>, "title"> & { tooltipDisabled?: boolean };
export default function ActivityButton({ tooltipDisabled = false, ...props }: Props) {
  const button = <IconButton variant="ghost" {...props} />;
  return tooltipDisabled ? (
    button
  ) : (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}
