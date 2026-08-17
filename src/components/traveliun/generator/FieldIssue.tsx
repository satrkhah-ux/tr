"use client";

import { createContext, useContext, useMemo } from "react";
import { AlertTriangle, XCircle } from "lucide-react";
import type { DraftIssue, FieldId } from "@/lib/offer/draft-validation";

/**
 * The problem, printed under the box that has it.
 *
 * The generator has always validated correctly and reported it in the worst
 * possible place: a panel on the far side of the screen saying «اختر دولة
 * الرحلة» while the country select sat unmarked. The agent had to translate a
 * sentence into a location. Now the sentence lives at the location.
 *
 * A CONTEXT rather than a prop threaded through eleven stage components: the
 * message belongs next to one input, several levels down inside a form, and
 * passing an issue list through every intermediate component to reach it would
 * make every one of them know about validation.
 *
 * The side panel stays. It answers a different question — "what is left on the
 * whole file" — which is what you want before issuing, not while typing.
 */

type IssueLookup = (field: FieldId) => DraftIssue[];

const FieldIssueContext = createContext<IssueLookup>(() => []);

export function FieldIssueProvider({
  issues,
  render,
  children,
}: {
  issues: DraftIssue[];
  /** turns an issue into its localized sentence — the shell owns the i18n. */
  render: (issue: DraftIssue) => string;
  children: React.ReactNode;
}) {
  const value = useMemo<IssueLookup>(() => {
    const byField = new Map<FieldId, DraftIssue[]>();
    for (const issue of issues) {
      if (!issue.field) continue;
      const list = byField.get(issue.field);
      if (list) list.push(issue);
      else byField.set(issue.field, [issue]);
    }
    return (field: FieldId) => byField.get(field) ?? [];
  }, [issues]);

  return (
    <FieldIssueContext.Provider value={value}>
      <RenderContext.Provider value={render}>{children}</RenderContext.Provider>
    </FieldIssueContext.Provider>
  );
}

const RenderContext = createContext<(issue: DraftIssue) => string>(() => "");

/**
 * The anchor a «فحص العرض» row links to.
 *
 * Plain hash navigation, deliberately: the browser scrolls to it for free, the
 * link survives a full page load, and there is no scroll-position state to keep
 * in sync with the router.
 */
export function fieldAnchorId(field: FieldId): string {
  return `f-${field.replace(/\./g, "-")}`;
}

/** The issues on one field — for a component that needs to restyle its input. */
export function useFieldIssues(field: FieldId): DraftIssue[] {
  return useContext(FieldIssueContext)(field);
}

/**
 * Border colour for an input that has something wrong with it.
 *
 * Returns "" when the field is clean, so it appends to the shared fieldClass
 * without a conditional at every call site.
 */
export function useFieldRing(field: FieldId): string {
  const issues = useFieldIssues(field);
  if (issues.length === 0) return "";
  return issues.some((i) => i.severity === "blocking")
    ? " border-[#e0879b] focus:border-[#c22850]"
    : " border-[#e8cf95] focus:border-[#a86a10]";
}

/** The message itself. Renders nothing when the field is fine. */
export function FieldIssue({ field, className }: { field: FieldId; className?: string }) {
  const issues = useFieldIssues(field);
  const render = useContext(RenderContext);
  if (issues.length === 0) return null;

  return (
    <div
      id={fieldAnchorId(field)}
      // The box itself sits just ABOVE this message, and the app header is
      // sticky — without the margin the browser scrolls the message to the top
      // and hides the very input it is about.
      className={`grid scroll-mt-32 gap-1 ${className ?? ""}`}
    >
      {issues.map((issue, index) => {
        const blocking = issue.severity === "blocking";
        const Icon = blocking ? XCircle : AlertTriangle;
        return (
          <p
            key={`${issue.key ?? issue.invariant?.code ?? "issue"}-${index}`}
            // Not role="alert": these are present on first paint for an empty
            // form, and eleven of them announced at once is noise, not help.
            className={`flex items-start gap-1.5 text-[11.5px] font-bold ${
              blocking ? "text-[#c22850]" : "text-[#a86a10]"
            }`}
          >
            <Icon className="mt-[1px] size-3.5 shrink-0" />
            <span>{render(issue)}</span>
          </p>
        );
      })}
    </div>
  );
}
