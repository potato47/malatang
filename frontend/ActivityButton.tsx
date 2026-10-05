import React from "react";
import { IconButton, Tooltip } from "@semicoder/malatang-sdk/ui";
type Props = Omit<React.ComponentProps<typeof IconButton>, "title"> & { tooltipDisabled?: boolean };
export default function ActivityButton({ tooltipDisabled = false, ...props }: Props) {
  const button = <IconButton variant="ghost" {...props} />;
  return tooltipDisabled ? button : <Tooltip content={props.label}>{button}</Tooltip>;
}
