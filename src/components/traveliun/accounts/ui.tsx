import { DirText } from "@/components/DirText";
import { MONTHS } from "@/lib/finance/model";

/** «الحسابات»' shared look: the card, an amount, a number kept left-to-right inside Arabic. */
export const card = "tv-card rounded-2xl border p-4 sm:p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
export const sar = (n: number, currency = "SAR") => `${Math.round(n).toLocaleString("en-US")} ${currency === "SAR" ? "ر.س" : currency}`;
export const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const Num = ({ children, className = "" }: { children: string; className?: string }) => (
  <span className={`tv-tnum ${className}`}>
    <DirText dir="ltr">{children}</DirText>
  </span>
);
