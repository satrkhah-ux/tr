import type { ReactNode } from "react";

type DirTextProps = {
  dir?: "ltr" | "rtl" | "auto";
  children: ReactNode;
  className?: string;
};

/**
 * Bidi isolation helper (handoff section 7).
 * Wrap latin text / numbers / serials / prices / dates / phones so they render
 * correctly inside the RTL layout. Purely presentational — no logic.
 */
export function DirText({ dir = "ltr", children, className }: DirTextProps) {
  return (
    <bdi dir={dir} className={className} style={{ unicodeBidi: "isolate", display: "inline-block" }}>
      {children}
    </bdi>
  );
}
