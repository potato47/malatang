import React, { type ComponentProps } from "react";
import { Checkbox as BCheckbox } from "@base-ui/react/checkbox";
import { Radio as BRadio } from "@base-ui/react/radio";
import { RadioGroup as BRadioGroup } from "@base-ui/react/radio-group";
import { Switch as BSwitch } from "@base-ui/react/switch";
import { NumberField as BNumber } from "@base-ui/react/number-field";
import { Slider as BSlider } from "@base-ui/react/slider";
import { Check, Minus, Plus } from "lucide-react";
import { FieldContext, useControl } from "./basic";
import { cx } from "./utils";
type Public<P> = Omit<P, "className"> & { className?: string };
export function Checkbox({ className, ...props }: Public<ComponentProps<typeof BCheckbox.Root>>) {
  return (
    <BCheckbox.Root
      nativeButton
      render={<button type="button" />}
      {...props}
      {...useControl(props)}
      className={cx("m-checkbox", className)}
    >
      <BCheckbox.Indicator>
        <Check size={12} />
      </BCheckbox.Indicator>
    </BCheckbox.Root>
  );
}
export function RadioGroup({
  className,
  children,
  ...props
}: Public<ComponentProps<typeof BRadioGroup>>) {
  const control = useControl(props);
  return (
    <BRadioGroup {...props} {...control} className={cx("m-radio-group", className)}>
      <FieldContext.Provider value={{ id: "" }}>{children}</FieldContext.Provider>
    </BRadioGroup>
  );
}
export function Radio({ className, ...props }: Public<ComponentProps<typeof BRadio.Root>>) {
  return (
    <BRadio.Root
      nativeButton
      render={<button type="button" />}
      {...props}
      {...useControl(props)}
      className={cx("m-radio", className)}
    >
      <BRadio.Indicator className="m-radio-dot" />
    </BRadio.Root>
  );
}
export function Switch({ className, ...props }: Public<ComponentProps<typeof BSwitch.Root>>) {
  return (
    <BSwitch.Root
      nativeButton
      render={<button type="button" />}
      {...props}
      {...useControl(props)}
      className={cx("m-switch", className)}
    >
      <BSwitch.Thumb />
    </BSwitch.Root>
  );
}
export function NumberField({ className, ...props }: Public<ComponentProps<typeof BNumber.Root>>) {
  const control = useControl(props);
  return (
    <BNumber.Root {...props} id={control.id} className={cx("m-number-field", className)}>
      <BNumber.Group>
        <BNumber.Decrement aria-label="减少">
          <Minus size={14} />
        </BNumber.Decrement>
        <BNumber.Input {...control} />
        <BNumber.Increment aria-label="增加">
          <Plus size={14} />
        </BNumber.Increment>
      </BNumber.Group>
    </BNumber.Root>
  );
}
export function Slider({ className, ...props }: Public<ComponentProps<typeof BSlider.Root>>) {
  const control = useControl(props);
  const value = props.value ?? props.defaultValue;
  const count = Array.isArray(value) ? value.length : 1;
  return (
    <BSlider.Root {...props} {...control} className={cx("m-slider", className)}>
      <BSlider.Control data-part="control">
        <BSlider.Track data-part="track">
          <BSlider.Indicator data-part="indicator" />
        </BSlider.Track>
        {Array.from({ length: count }, (_, index) => (
          <BSlider.Thumb
            key={index}
            index={index}
            data-part="thumb"
            aria-label={props["aria-label"]}
            aria-labelledby={control["aria-labelledby"]}
            aria-describedby={control["aria-describedby"]}
          />
        ))}
      </BSlider.Control>
    </BSlider.Root>
  );
}
