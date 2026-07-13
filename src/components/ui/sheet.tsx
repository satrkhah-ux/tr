"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "@/lib/utils";

/**
 * Sheet — a side drawer built on Base UI Dialog (focus trap, Escape,
 * outside-click, scroll lock, focus-return). Used for the mobile nav drawer.
 * `side` is logical (inline-start/inline-end) so it mirrors correctly in RTL.
 */
type SheetSide = "inline-start" | "inline-end";

function Sheet(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />;
}

function SheetTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetContent({
  className,
  children,
  side = "inline-start",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup> & { side?: SheetSide }) {
  const start = side === "inline-start";
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        className={cn(
          "fixed inset-0 z-[150] bg-black/25",
          "transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
        )}
      />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 z-[160] flex h-full w-[300px] max-w-[85vw] flex-col overflow-y-auto bg-white shadow-[0_0_40px_rgba(0,0,0,0.2)] outline-none",
          "transition-transform duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]",
          start
            ? "start-0 data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full rtl:data-[starting-style]:translate-x-full rtl:data-[ending-style]:translate-x-full"
            : "end-0 data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full rtl:data-[starting-style]:-translate-x-full rtl:data-[ending-style]:-translate-x-full",
          "dark:bg-[#0f1f1b]",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetContent };
