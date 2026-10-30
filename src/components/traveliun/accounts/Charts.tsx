"use client";

import { useId } from "react";
import { Num } from "./ui";

/**
 * «الحسابات»' charts (the owner, 2026-10-31: a dashboard «قريب على هذا وافضل منه»): smooth area lines,
 * a ring, a donut, grouped bars and one stacked bar — plain SVG in the section's two series colours
 * (accounts.css). Time runs right to left, as the page reads.
 */

/** the series palette, in order — fill, stroke and swatch classes for each */
export const SERIES = [
  { fill: "fill-[var(--acc-indigo)]", stroke: "stroke-[var(--acc-indigo)]", bg: "bg-[var(--acc-indigo)]", stop: "[stop-color:var(--acc-indigo)]" },
  { fill: "fill-[var(--acc-orange)]", stroke: "stroke-[var(--acc-orange)]", bg: "bg-[var(--acc-orange)]", stop: "[stop-color:var(--acc-orange)]" },
  { fill: "fill-[var(--acc-indigo-soft)]", stroke: "stroke-[var(--acc-indigo-soft)]", bg: "bg-[var(--acc-indigo-soft)]", stop: "[stop-color:var(--acc-indigo-soft)]" },
  { fill: "fill-[var(--acc-orange-soft)]", stroke: "stroke-[var(--acc-orange-soft)]", bg: "bg-[var(--acc-orange-soft)]", stop: "[stop-color:var(--acc-orange-soft)]" },
  { fill: "fill-tv-text-faint", stroke: "stroke-tv-text-faint", bg: "bg-tv-text-faint", stop: "[stop-color:var(--tv-text-faint)]" },
];
const tone = (i: number) => SERIES[i % SERIES.length];

const short = (n: number) => {
  const a = Math.abs(n);
  return a >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : a >= 1_000 ? `${Math.round(n / 1_000)}K` : String(Math.round(n));
};

/** a curve through the points (Catmull-Rom as cubic Béziers) */
function smooth(p: [number, number][]): string {
  if (p.length < 2) return p.length ? `M${p[0][0]},${p[0][1]}` : "";
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const [a, b, c, e] = [p[i - 1] ?? p[i], p[i], p[i + 1], p[i + 2] ?? p[i + 1]];
    d += ` C${b[0] + (c[0] - a[0]) / 6},${b[1] + (c[1] - a[1]) / 6} ${c[0] - (e[0] - b[0]) / 6},${c[1] - (e[1] - b[1]) / 6} ${c[0]},${c[1]}`;
  }
  return d;
}

export function Legend({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11.5px] font-bold text-tv-text-muted">
      {items.map((l, i) => (
        <li key={l} className="flex items-center gap-1.5"><span className={`h-1 w-4 rounded-full ${tone(i).bg}`} />{l}</li>
      ))}
    </ul>
  );
}

/** smooth lines with a soft fill under each; values below zero sit under the zero line */
export function AreaLines({ labels, series, height = 210 }: { labels: string[]; series: { name: string; values: number[] }[]; height?: number }) {
  const id = useId();
  const W = 640, H = height, top = 14, bottom = 26, left = 8, right = 44;
  const all = series.flatMap((s) => s.values);
  const max = Math.max(...all, 1), min = Math.min(...all, 0);
  const x = (i: number) => W - right - (labels.length === 1 ? 0 : (i * (W - left - right)) / (labels.length - 1));
  const y = (v: number) => top + ((max - v) / (max - min)) * (H - top - bottom);
  const ticks = [0, 1, 2, 3].map((k) => min + ((max - min) * k) / 3);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full [direction:ltr]" role="img"
        aria-label={series.map((s) => `${s.name}: ${labels.map((l, i) => `${l} ${Math.round(s.values[i])}`).join("، ")}`).join(" — ")}>
        <defs>
          {series.map((s, si) => (
            <linearGradient key={s.name} id={`${id}-${si}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" className={tone(si).stop} stopOpacity={0.32} />
              <stop offset="100%" className={tone(si).stop} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - right + 6} y1={y(t)} y2={y(t)} className="stroke-[var(--acc-track)]" strokeDasharray={t === 0 ? undefined : "4 6"} />
            <text x={W - 2} y={y(t) + 4} textAnchor="end" className="fill-tv-text-faint text-[11px] font-semibold">{short(t)}</text>
          </g>
        ))}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => [x(i), y(v)] as [number, number]);
          const line = smooth(pts);
          return (
            <g key={s.name}>
              <path d={`${line} L${pts[pts.length - 1][0]},${y(Math.max(min, 0))} L${pts[0][0]},${y(Math.max(min, 0))} Z`} fill={`url(#${id}-${si})`} />
              <path d={line} fill="none" className={tone(si).stroke} strokeWidth={3} strokeLinecap="round" />
              {pts.map(([px, py], i) => (
                <circle key={labels[i]} cx={px} cy={py} r={i === pts.length - 1 ? 5.5 : 3.5} className={`${tone(si).stroke} fill-tv-surface-raised`} strokeWidth={2.5} />
              ))}
            </g>
          );
        })}
        {labels.map((l, i) => (
          <text key={l} x={x(i)} y={H - 6} textAnchor="middle" className="fill-tv-text-faint text-[11.5px] font-bold">{l}</text>
        ))}
      </svg>
      <figcaption className="mt-1"><Legend items={series.map((s) => s.name)} /></figcaption>
    </figure>
  );
}

/** a progress ring, the share in its middle */
export function Ring({ share, caption, size = 168 }: { share: number | null; caption: string; size?: number }) {
  const id = useId();
  const v = Math.max(0, Math.min(100, share ?? 0));
  const r = 42, c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="progressbar" aria-valuenow={share ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={caption}>
        <defs>
          <linearGradient id={id} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" className={SERIES[2].stop} />
            <stop offset="100%" className={SERIES[0].stop} />
          </linearGradient>
        </defs>
        <circle cx={50} cy={50} r={r} fill="none" className="stroke-[var(--acc-track)]" strokeWidth={9} />
        <circle cx={50} cy={50} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={9} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <Num className="text-[34px] font-light leading-none text-tv-text-strong">{share == null ? "—" : `${share}%`}</Num>
      </span>
    </div>
  );
}

/** a donut of parts, the total's name in its middle */
export function Donut({ parts, center }: { parts: { label: string; value: number }[]; center: string }) {
  const r = 38, c = 2 * Math.PI * r;
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  const lens = parts.map((p) => (Math.max(0, p.value) / total) * c);
  const starts = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative size-44">
        <svg viewBox="0 0 100 100" className="size-full -rotate-90" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join("، ")}>
          <circle cx={50} cy={50} r={r} fill="none" className="stroke-[var(--acc-track)]" strokeWidth={14} />
          {parts.map((p, i) => (
            <circle key={p.label} cx={50} cy={50} r={r} fill="none" className={tone(i).stroke} strokeWidth={14} strokeDasharray={`${Math.max(0, lens[i] - 1.2)} ${c}`} strokeDashoffset={-starts[i]} />
          ))}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center px-8 text-center text-[11.5px] font-bold text-tv-text-muted">{center}</span>
      </div>
      <ul className="w-full space-y-1.5">
        {parts.map((p, i) => (
          <li key={p.label} className="flex items-center gap-2 text-[12.5px] font-bold">
            <span className={`size-2.5 rounded-full ${tone(i).bg}`} />
            <span className="min-w-0 flex-1 truncate text-tv-text-strong">{p.label}</span>
            <Num className="text-tv-text-faint">{`${Math.round((Math.max(0, p.value) / total) * 100)}%`}</Num>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** vertical bars, one or two per label */
export function Bars({ labels, series, height = 150, width = 320 }: { labels: string[]; series: { name: string; values: number[] }[]; height?: number; width?: number }) {
  const W = width, H = height, top = 10, bottom = 26;
  const max = Math.max(...series.flatMap((s) => s.values), 1);
  const slot = W / labels.length, bar = Math.min(26, (slot * 0.56) / series.length);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full [direction:ltr]" role="img"
        aria-label={series.map((s) => `${s.name}: ${labels.map((l, i) => `${l} ${Math.round(s.values[i])}`).join("، ")}`).join(" — ")}>
        {[0.25, 0.5, 0.75, 1].map((k) => (
          <line key={k} x1={0} x2={W} y1={top + (1 - k) * (H - top - bottom)} y2={top + (1 - k) * (H - top - bottom)} className="stroke-[var(--acc-track)]" strokeDasharray="4 6" />
        ))}
        {labels.map((l, i) => {
          const cx = W - slot * (i + 0.5);
          return (
            <g key={l}>
              {series.map((s, si) => {
                const h = (Math.max(0, s.values[i]) / max) * (H - top - bottom);
                const bx = cx - (series.length * bar) / 2 + si * bar + 2;
                return <rect key={s.name} x={bx} y={H - bottom - h} width={bar - 4} height={Math.max(h, 2)} rx={4} className={tone(si).fill} />;
              })}
              <text x={cx} y={H - 7} textAnchor="middle" className="fill-tv-text-faint text-[11.5px] font-bold">{l}</text>
            </g>
          );
        })}
      </svg>
      {series.length > 1 && <figcaption className="mt-1"><Legend items={series.map((s) => s.name)} /></figcaption>}
    </figure>
  );
}

/** one bar split into its parts, with the legend under it */
export function StackBar({ parts }: { parts: { label: string; value: number }[] }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0) || 1;
  return (
    <div>
      <div className="flex h-3.5 w-full gap-1 overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round(p.value)}`).join("، ")}>
        {parts.map((p, i) => (
          <span key={p.label} className={`h-full rounded-full ${tone(i).bg}`} style={{ width: `${(Math.max(0, p.value) / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] font-bold text-tv-text-muted">
        {parts.map((p, i) => (
          <li key={p.label} className="flex items-center gap-1.5"><span className={`size-2.5 rounded-sm ${tone(i).bg}`} />{p.label}</li>
        ))}
      </ul>
    </div>
  );
}
