"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { unzoomedRoot } from "./overlay-root";

/**
 * Select — Base UI single-choice wrapper. Closes on choose (terminal), closes
 * on outside-click / Escape / Tab-out, returns focus to the trigger, and does
 * keyboard type-ahead. RTL-correct via the app DirectionProvider.
 */

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root {...props} />;
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value {...props} />;
}

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-10 min-w-[9rem] items-center justify-between gap-2 rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-sm font-semibold text-[#185045] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus transition-colors",
        "hover:border-[#b7d0c7] focus-visible:border-[#2aa87a] data-[popup-open]:border-[#2aa87a]",
        "dark:border-[#294039] dark:bg-[#14231f] dark:text-[#d6e5df]",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="flex">
        <ChevronDown className="size-4 opacity-60" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Popup>) {
  return (
    <SelectPrimitive.Portal container={unzoomedRoot()}>
      <SelectPrimitive.Positioner sideOffset={6} className="z-[170] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus" alignItemWithTrigger={false}>
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "[zoom:var(--tv-zoom)] max-h-[min(320px,calc(var(--available-height)/var(--tv-zoom)))] min-w-[calc(var(--anchor-width)/var(--tv-zoom))] overflow-y-auto rounded-md border border-[#d9e0dc] bg-white p-1 text-[#185045] shadow-[0_10px_30px_rgba(0,0,0,0.16)] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus",
            "dark:border-[#294039] dark:bg-[#14231f] dark:text-[#d6e5df]",
            className,
          )}
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-[7px] py-2 pe-8 ps-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus transition-colors",
        "data-[highlighted]:bg-[#f2f7f5] data-[highlighted]:text-[#185045] dark:data-[highlighted]:bg-[#1b2d27]",
        className,
      )}
      {...props}
    >
      <span className="flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4 text-[#2aa87a]" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem };
