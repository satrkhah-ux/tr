import { cva } from "class-variance-authority"

/*
  Button looks, mapped to the design-system tokens (docs/design-system/components/button.md). Kept out of
  button.tsx ("use client") so server components and plain class constants can call them too.
  `buttonTone` is colour + focus only (the screen keeps its own size and disabled classes); `buttonVariants`
  is the full button. Every size is at least 40px tall on a phone.
*/
const tone = {
  default: "tv-btn-primary border-transparent",
  secondary: "tv-btn-secondary",
  ghost: "tv-btn-ghost border-transparent",
  outline:
    "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
  destructive:
    "border-transparent bg-destructive/10 text-destructive hover:bg-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30",
  link: "border-transparent text-primary underline-offset-4 hover:underline",
} as const

// border colour lives in each variant: a base border-transparent would sort after tv-btn-secondary and hide it
const focus = "outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus"

export const buttonTone = cva(focus, {
  variants: { variant: tone },
  defaultVariants: { variant: "default" },
})

export const buttonVariants = cva(
  `group/button inline-flex shrink-0 items-center justify-center rounded-lg border bg-clip-padding text-sm font-medium whitespace-nowrap transition-all select-none ${focus} active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
  {
    variants: {
      variant: tone,
      size: {
        default:
          "h-8 gap-1.5 px-2.5 max-sm:min-h-10 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs max-sm:min-h-10 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] max-sm:min-h-10 in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 max-sm:min-h-10 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8 max-sm:min-h-10 max-sm:min-w-10",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] max-sm:min-h-10 max-sm:min-w-10 in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] max-sm:min-h-10 max-sm:min-w-10 in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9 max-sm:min-h-10 max-sm:min-w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)
