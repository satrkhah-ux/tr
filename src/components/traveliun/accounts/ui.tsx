import { DirText } from "@/components/DirText";
import { MONTHS } from "@/lib/finance/model";

/** «الحسابات»' shared look: the card, an amount, a number kept left-to-right inside Arabic. */
export const card = "tv-card min-w-0 rounded-[22px] border p-4 sm:p-5";
/** an amount that may be a loss, said in words — never a bare minus */
export const money = (n: number) => (n < 0 ? `خسارة ${sar(-n)}` : sar(n));
export const sar = (n: number, currency = "SAR") => `${Math.round(n).toLocaleString("en-US")} ${currency === "SAR" ? "ر.س" : currency}`;
export const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const Num = ({ children, className = "" }: { children: string; className?: string }) => (
  <span className={`tv-tnum ${className}`}>
    <DirText dir="ltr">{children}</DirText>
  </span>
);
