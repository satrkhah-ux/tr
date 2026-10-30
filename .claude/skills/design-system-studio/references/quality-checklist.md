# Quality checklist

Use only the checks relevant to the task. Report findings and distinguish verified checks from items that could not be tested.

## Design-system quality

- [ ] Tokens express reusable intent and have consistent names and units.
- [ ] No new token duplicates an existing value without a clear semantic reason.
- [ ] Shared components have a documented purpose, anatomy, variants, and state coverage.
- [ ] Product-specific behavior remains in composition unless it is genuinely reusable.
- [ ] Design terminology maps to concrete code tokens, component props, or examples.
- [ ] Exceptions are documented instead of silently forcing every screen into one pattern.
- [ ] A source-level change can be traced to its consuming instances.

## Accessibility and interaction

- [ ] Text and essential UI contrast are checked against the applicable standard and actual rendered colors.
- [ ] Keyboard users can reach and operate interactive elements.
- [ ] Focus is visible and not conveyed by color alone.
- [ ] Controls have accessible names and meaningful semantics.
- [ ] Disabled, loading, validation, error, and selected states are communicated appropriately.
- [ ] Touch targets, zoom, motion, and responsive behavior are considered where relevant.
- [ ] Localization and longer labels do not break layout or hide content.

## Change and delivery

- [ ] Existing consumers and likely impact are identified before shared changes.
- [ ] Breaking changes have a migration note and are not applied silently.
- [ ] Relevant automated checks were run, or their absence is stated.
- [ ] Visual behavior was inspected when visual changes were made and the environment permits it.
- [ ] User-facing documentation is in Arabic by default and avoids claiming unverified integrations.
