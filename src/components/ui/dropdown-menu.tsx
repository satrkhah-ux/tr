"use client";

import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * DropdownMenu — Base UI Menu wrapper. Items CLOSE the menu on activation by
 * default (terminal actions: navigation, single-choice, row actions). Use
 * CheckboxItem for NON-terminal toggles — it sets closeOnClick=false so the
 * menu stays open across multiple toggles; pair it with a "Done" item/button.
 */
type Side = React.ComponentProps<typeof MenuPrimitive.Positioner>["side"];
type Align = React.ComponentProps<typeof MenuPrimitive.Positioner>["align"];

function DropdownMenu(props: React.ComponentProps<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root {...props} />;
}

function DropdownMenuTrigger(props: React.ComponentProps<typeof MenuPrimitive.Trigger>) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className,
  side = "bottom",
  align = "end",
  sideOffset = 8,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Popup> & {
  side?: Side;
  align?: Align;
  sideOffset?: number;
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner side={side} align={align} sideOffset={sideOffset} className="z-[120] outline-none">
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "min-w-[11rem] w-[max-content] max-w-[min(340px,calc(100vw-24px))] origin-[var(--transform-origin)] rounded-md border border-[#d9e0dc] bg-white p-1.5 text-[#003c3a] shadow-[0_10px_30px_rgba(0,0,0,0.16)] outline-none",
            "transition-[opacity,transform] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            "dark:border-[#294039] dark:bg-[#14231f] dark:text-[#eaf3ef]",
            className,
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-[7px] px-3 py-2 text-sm font-medium text-[#185045] outline-none transition-colors",
        "data-[highlighted]:bg-[#f2f7f5] data-[highlighted]:text-[#185045] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "dark:text-[#d6e5df] dark:data-[highlighted]:bg-[#1b2d27]",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      closeOnClick={false}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-[7px] py-2 pe-3 ps-2 text-sm font-medium text-[#185045] outline-none transition-colors",
        "data-[highlighted]:bg-[#f2f7f5] dark:text-[#d6e5df] dark:data-[highlighted]:bg-[#1b2d27]",
        className,
      )}
      {...props}
    >
      <span className="flex size-4 items-center justify-center">
        <MenuPrimitive.CheckboxItemIndicator>
          <Check className="size-4 text-[#2aa87a]" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn("-mx-0.5 my-1 h-px bg-[#eef2f0] dark:bg-[#294039]", className)} {...props} />;
}

function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.GroupLabel>) {
  return <MenuPrimitive.GroupLabel className={cn("px-3 py-1.5 text-[11px] font-bold text-[#8aa29b]", className)} {...props} />;
}

function DropdownMenuGroup(props: React.ComponentProps<typeof MenuPrimitive.Group>) {
  return <MenuPrimitive.Group {...props} />;
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
};
