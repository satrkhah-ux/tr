---
name: design-system-studio
description: Designs, audits, documents, and incrementally implements maintainable design systems across product interfaces. Use when creating or improving design tokens, component libraries, UI consistency, design-to-code mappings, accessibility rules, or when a change must propagate safely across many screens.
---

# Design System Studio

Turn repeated interface decisions into a clear, reusable source of truth for design and code. Work with the files, framework, and conventions already present; do not assume access to a design tool or claim a design-to-code connection that has not been verified.

## Operating workflow

1. **Clarify the deliverable.** Determine whether the user wants an audit, a written specification, code changes, or all three. Ask only for missing information that materially affects the result, such as target platform, existing brand rules, or permission to modify files.
2. **Inspect before proposing.** When project files are available, identify the framework, current styling approach, existing tokens, reusable components, duplicated patterns, and available tests. Preserve sound conventions and list assumptions. If no project is available, provide a portable specification and state the assumed stack only when code examples require one.
3. **Map the current interface.** Group repeated elements by purpose, anatomy, variants, states, and responsive behavior. Separate genuine differences from accidental inconsistency. Do not invent components merely to make the library look larger.
4. **Define the system.** Establish a small token hierarchy: primitive values, semantic aliases, and component-level tokens only where they add real value. Define naming, usage rules, accessibility expectations, and a migration approach. See `references/system-method.md` and `references/quality-checklist.md` when needed.
5. **Build one source of truth.** Prefer the project's existing token and component format. Keep design decisions and implementation mappings explicit. Use the files in `templates/` as adaptable starting points, not rigid requirements. Do not add dependencies or replace a styling architecture without a clear need.
6. **Prove the update path.** Implement or demonstrate one representative component and show how changing its source token or base component affects its instances. For broader migrations, make small, reviewable batches and preserve existing behavior unless the user requests a redesign.
7. **Validate.** Run available lint, type, build, unit, accessibility, and visual checks relevant to the changes. If a check cannot run, say why; never imply that an unrun test passed. Review contrast, keyboard behavior, focus visibility, loading/disabled/error states, and responsive behavior.
8. **Deliver clearly.** Summarize the source of truth, what changed, how to extend it, validation performed, and known gaps. Write user-facing explanations and generated documentation in Arabic unless the user explicitly requests another language. Keep identifiers, code, and framework conventions in their appropriate language.

## Design rules

- Use semantic tokens for intent (`text.primary`, `surface.canvas`, `action.primary`) instead of scattering raw colors or spacing values through components.
- Keep token layers understandable. Avoid one-off aliases, unused values, and tokens that merely rename the same value without clarifying intent.
- Specify each component's purpose, anatomy, allowed variants, states, content constraints, and accessibility behavior. Make the common path easy and prevent invalid combinations where the codebase permits it.
- Make shared components genuinely reusable. Keep product-specific composition in the consuming screen rather than accumulating unrelated flags in a universal component.
- Keep design and code terminology aligned. Map a documented design decision to a concrete token, component, prop, or usage example.
- Treat an established design system as the default. Before changing a shared component, identify its consumers and potential impact. Prefer backward-compatible changes and a migration note for breaking changes.
- Do not claim that Figma, a design library, generated code, or screenshots are synchronized unless the supplied project contains a verifiable integration or the user provides evidence of one.
- Do not overwrite, delete, or mass-refactor user files without explicit authorization. Present a plan first for broad or breaking changes.

## Output format

For a new or audited system, provide the most relevant sections from this list in Arabic: system purpose and assumptions; token structure; component inventory and specifications; design-to-code mapping; accessibility and responsive rules; adoption/migration steps; validation results; unresolved decisions. Omit sections that do not apply. For code work, link or name the changed files and distinguish implemented behavior from recommendations.

## Examples

- “Create a design system for this existing React app. Audit the current UI first, then implement the primary button and tokens without changing unrelated screens.”
- “All 30 screens use slightly different blue buttons. Find the common patterns, propose a safe consolidation plan, and show which files would change.”
- “Turn this brand guide into semantic color and spacing tokens plus component usage rules. Do not invent missing brand values.”
- “Review this component library for accessibility and consistency, then return the findings and prioritized fixes in Arabic.”
