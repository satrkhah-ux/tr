"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import { cn } from "@/lib/utils";

/**
 * Popover — Base UI wrapper. Handles outside-click, Escape (topmost only),
 * focus-return-to-trigger, and RTL anchoring (via the app's DirectionProvider)
 * for free. Use for utility panels (settings/calculator/customization).
 */
type Side = React.ComponentProps<typeof PopoverPrimitive.Positioner>["side"];
type Align = React.ComponentProps<typeof PopoverPrimitive.Positioner>["align"];

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props} />;
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  side = "bottom",
  align = "end",
  sideOffset = 10,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Popup> & {
  side?: Side;
  align?: Align;
  sideOffset?: number;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className="z-[120] outline-none"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "max-h-[var(--available-height)] w-[min(360px,calc(100vw-24px))] origin-[var(--transform-origin)] overflow-y-auto rounded-md border border-[#d9e0dc] bg-white p-4 text-[#003c3a] shadow-[0_10px_30px_rgba(0,0,0,0.16)] outline-none",
            "transition-[opacity,transform] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            "dark:border-[#294039] dark:bg-[#14231f] dark:text-[#eaf3ef]",
            className,
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
