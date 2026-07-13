import { cn } from "@/lib/utils";

export type TraveliunStatusTone = "confirmed" | "sent" | "draft" | "cancelled";

type StatusMeta = {
  label: string;
  color: string;
  bg: string;
};

/** Semantic status palette (handoff section 6.1 / 9). */
const STATUS_META: Record<TraveliunStatusTone, StatusMeta> = {
  confirmed: { label: "مؤكد", color: "#0f7a52", bg: "#e3f6ee" },
  sent: { label: "مُرسل", color: "#0e7490", bg: "#dff1f4" },
  draft: { label: "مسودة", color: "#5b6b78", bg: "#eef1f4" },
  cancelled: { label: "ملغي", color: "#be123c", bg: "#fdeaef" },
};

/**
 * Maps the real (English/mixed) status strings used across the data layer onto a
 * semantic tone. Presentational mapping only — it never changes stored values.
 */
export function statusTone(raw?: string): TraveliunStatusTone {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return "draft";
  if (value.includes("cancel") || value.includes("ملغي")) return "cancelled";
  if (value.includes("sent") || value.includes("مرسل") || value.includes("مُرسل") || value.includes("program") || value.includes("برنامج")) {
    return "sent";
  }
  if (value.includes("draft") || value.includes("مسودة") || value.includes("not")) return "draft";
  // Active / Confirmed / مؤكد / فعال …
  return "confirmed";
}

type StatusBadgeProps = {
  tone: TraveliunStatusTone;
  /** Optional override label (defaults to the Arabic label for the tone). */
  label?: string;
  className?: string;
};

export function StatusBadge({ tone, label, className }: StatusBadgeProps) {
  const meta = STATUS_META[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[7px] whitespace-nowrap rounded-full px-3 py-[5px] text-xs font-extrabold",
        className,
      )}
      style={{ background: meta.bg, color: meta.color }}
    >
      <span className="size-[7px] shrink-0 rounded-full" style={{ background: meta.color }} />
      {label ?? meta.label}
    </span>
  );
}
