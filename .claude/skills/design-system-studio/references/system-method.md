# System method

Use this method as a decision guide, not a mandatory framework. Preserve a project's working conventions where possible.

## 1. Inventory before standardizing

Record repeated UI patterns and where they occur. For each candidate, note purpose, anatomy, variants, interactive states, responsive behavior, and meaningful exceptions. Separate true product differences from accidental drift. Flag uncertainty rather than converting guesses into policy.

A useful inventory entry is:

```text
Pattern: Primary action button
Consumers: checkout, onboarding, account settings
Anatomy: label; optional leading/trailing icon
Variants: primary, secondary, destructive, quiet
States: default, hover, focus-visible, active, disabled, loading
Exceptions: destructive action requires confirmation context
Evidence: paths, screenshots, supplied design files, or user notes
```

## 2. Use a small token hierarchy

Prefer three levels only when each level provides value:

- **Primitive:** raw palette or scale values, such as `blue.600` or `space.4`.
- **Semantic:** purpose-based aliases, such as `action.primary` or `surface.canvas`.
- **Component token:** a local override only when a shared component has a real need, such as `button.primary.background`.

Keep a clear path from a component property to its semantic intent and, when useful, to the primitive value. Avoid duplicating token layers that add no meaning. Define naming and units consistently, and include theme differences only when the product actually supports them.

## 3. Specify components as contracts

For each foundational component, document:

- purpose and when not to use it;
- anatomy and content constraints;
- variants, sizes, and allowed combinations;
- visual, interaction, loading, disabled, error, and focus states that apply;
- keyboard and assistive-technology expectations;
- responsive behavior and localization considerations;
- mapping from design names to implementation tokens, props, and examples.

Keep the default path simple. Do not create a universal component with many unrelated boolean props to cover every screen.

## 4. Connect documentation to implementation

Use the existing codebase's token format (CSS custom properties, theme objects, design-token JSON, or another established approach). The same semantic name should be traceable through documentation, code, and usage examples. If design-tool source files are unavailable, document the intended mapping without claiming a live connection.

## 5. Roll out safely

1. Select one high-frequency, low-risk pattern.
2. Implement its token and shared component contract.
3. Migrate a small representative set of consumers.
4. Check for visual, behavioral, accessibility, and responsive regressions.
5. Expand in reviewable batches; document exceptions and breaking changes.
6. Remove obsolete styles only after confirming no consumers remain.

For a system with many screens, map consumers before a global edit. Prefer codemods or repeatable transformations only when the repository's conventions and tests support them. Show the proposed file scope before a broad migration.

## 6. Keep ownership clear

Document who approves changes, how tokens/components are named, how deprecations are announced, and which layer owns each rule. Keep process proportional to team size; a solo project usually needs a short contribution note, not an elaborate governance board.
