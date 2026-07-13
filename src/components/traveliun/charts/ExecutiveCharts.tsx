"use client";

/**
 * Executive-dashboard charts. Pure recharts (SVG) so they SSR/hydrate cleanly,
 * render Arabic labels as real <text> nodes, and mirror correctly in RTL by
 * driving axis orientation from `dir` (no whole-SVG mirroring). These are dumb
 * renderers: all labels arrive already translated/formatted from the caller.
 */

import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  LabelList,
} from "recharts";

// Series colours are theme-agnostic (mid-tone, readable on light + dark cards).
const BRAND = "#185045";
const GREEN = "#2aa87a";
const GOLD = "#d99a00";
// Chart CHROME (axis text / grid / legend / slice separators). recharts writes
// these as SVG presentation attributes; the light values live here and dark mode
// overrides them via `.dark .recharts-*` CSS rules in globals.css (CSS wins over
// SVG presentation attributes). CSS variables can't be used — Tailwind v4's
// Lightning CSS prunes custom properties no CSS rule references.
const INK = "#0f3d38";
const MUTED = "#8aa29b";
const GRID = "#e6efeb";
const SEP = "#ffffff";

export const DEST_PALETTE = ["#185045", "#2aa87a", "#d99a00", "#c2603b", "#5b7fb3", "#7a6ea8", "#0e9bb5", "#0f7a52"];

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
function fmt(n: number): string {
  return nf0.format(Math.round(n));
}

type Dir = "rtl" | "ltr";

type TooltipEntry = { name?: string | number; value?: number | string; color?: string };
type ChartTooltipProps = { active?: boolean; payload?: TooltipEntry[]; label?: string | number; unit?: string };

/** Shared tooltip: LTR numbers, Arabic-friendly label, on a white card. */
function ChartTooltip({ active, payload, label, unit }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-[10px] border border-[#e2ebe7] bg-white px-3 py-2 shadow-[0_6px_20px_rgba(0,60,58,0.12)]">
      {label != null && label !== "" ? (
        <p className="mb-1 text-[12px] font-extrabold text-[#003c3a]">{String(label)}</p>
      ) : null}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 text-[12px] font-semibold text-[#557d78]">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: p.color ?? GREEN }} />
          <span>{p.name}</span>
          <span dir="ltr" className="tv-tnum ms-auto font-extrabold text-[#0f3d38]">
            {fmt(Number(p.value ?? 0))}{unit ? ` ${unit}` : ""}
          </span>
        </p>
      ))}
    </div>
  );
}

const axisTick = { fill: INK, fontSize: 11, fontWeight: 700 } as const;
const valueTick = { fill: MUTED, fontSize: 10 } as const;

// ---------- Monthly: sell bars + profit line ----------
export function MonthlyChart({
  data,
  sellLabel,
  profitLabel,
  unit,
  dir = "rtl",
}: {
  data: { label: string; sell: number; profit: number }[];
  sellLabel: string;
  profitLabel: string;
  unit?: string;
  dir?: Dir;
}) {
  return (
    <div className="h-[300px] w-full" dir={dir}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} reversed={dir === "rtl"} interval={0} height={40} angle={data.length > 6 ? -30 : 0} textAnchor={data.length > 6 ? "end" : "middle"} />
          <YAxis tick={valueTick} tickLine={false} axisLine={false} orientation={dir === "rtl" ? "right" : "left"} width={44} tickFormatter={fmt} />
          <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: "rgba(42,168,122,0.06)" }} />
          <Legend wrapperStyle={{ fontSize: 12, fontWeight: 700, paddingTop: 6 }} />
          <Bar name={sellLabel} dataKey="sell" fill={GREEN} radius={[5, 5, 0, 0]} maxBarSize={46} />
          <Line name={profitLabel} type="monotone" dataKey="profit" stroke={GOLD} strokeWidth={2.5} dot={{ r: 3, fill: GOLD }} activeDot={{ r: 5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- Status distribution doughnut ----------
export function StatusDoughnut({ data }: { data: { name: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="h-[270px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2} stroke={SEP} strokeWidth={2}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
          <Legend
            verticalAlign="middle"
            align="right"
            layout="vertical"
            iconType="circle"
            formatter={(value, entry) => {
              const v = (entry?.payload as unknown as { value?: number })?.value ?? 0;
              const pct = total > 0 ? Math.round((v / total) * 100) : 0;
              return `${value} · ${pct}%`;
            }}
            wrapperStyle={{ fontSize: 12, fontWeight: 700, color: INK }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- Horizontal bar: sell by destination ----------
// The category labels get a reserved band via YAxis width; the numeric axis is
// hidden and each bar carries its value at the tip. In RTL a custom tick
// right-aligns the Arabic label INSIDE the band (recharts would otherwise anchor
// it at the axis line and let the text flow left over the bars).
const CAT_BAND = 100;

type CatTickProps = { x?: number; y?: number; payload?: { value?: string | number } };
// Right-align the Arabic label within the reserved band. The enclosing div is
// dir="rtl", so SVG text inherits direction:rtl and textAnchor="start" anchors
// the text's RIGHT edge — placing it at the band's right edge and flowing left,
// which keeps it inside the band and clear of the bars.
function RtlCatTick({ x = 0, y = 0, payload }: CatTickProps) {
  return (
    <text className="recharts-cartesian-axis-tick-value" x={x + CAT_BAND - 8} y={y} dy={4} textAnchor="start" fill={INK} fontSize={12} fontWeight={700}>
      {String(payload?.value ?? "")}
    </text>
  );
}

export function DestinationBar({ data, unit, dir = "rtl" }: { data: { label: string; value: number }[]; unit?: string; dir?: Dir }) {
  const rtl = dir === "rtl";
  return (
    <div className="h-[270px] w-full" dir={dir}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart layout="vertical" data={data} margin={{ top: 4, right: rtl ? 6 : 44, left: rtl ? 44 : 6, bottom: 4 }} barCategoryGap={10}>
          <XAxis type="number" hide reversed={rtl} domain={[0, "dataMax"]} />
          <YAxis
            type="category"
            dataKey="label"
            orientation={rtl ? "right" : "left"}
            width={CAT_BAND}
            tickLine={false}
            axisLine={false}
            tick={rtl ? <RtlCatTick /> : { fill: INK, fontSize: 12, fontWeight: 700 }}
          />
          <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: "rgba(42,168,122,0.06)" }} />
          <Bar dataKey="value" radius={4} maxBarSize={24} isAnimationActive={false}>
            {data.map((_, i) => (
              <Cell key={i} fill={DEST_PALETTE[i % DEST_PALETTE.length]} />
            ))}
            <LabelList dataKey="value" position={rtl ? "left" : "right"} formatter={(v) => fmt(Number(v ?? 0))} style={{ fill: MUTED, fontSize: 10, fontWeight: 700 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- Vertical bar: offer count by stage ----------
export function StageBar({ data, dir = "rtl" }: { data: { label: string; value: number }[]; dir?: Dir }) {
  return (
    <div className="h-[270px] w-full" dir={dir}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: INK, fontSize: 10, fontWeight: 700 }} tickLine={false} axisLine={{ stroke: GRID }} reversed={dir === "rtl"} interval={0} height={54} angle={-20} textAnchor="end" />
          <YAxis tick={valueTick} tickLine={false} axisLine={false} orientation={dir === "rtl" ? "right" : "left"} width={30} allowDecimals={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(42,168,122,0.06)" }} />
          <Bar dataKey="value" fill={BRAND} radius={[5, 5, 0, 0]} maxBarSize={46} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
