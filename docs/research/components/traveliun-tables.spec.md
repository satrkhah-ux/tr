# TraveliunDataPage Specification

## Overview
- **Target file:** `src/components/traveliun/TraveliunDataPage.tsx`
- **Screenshot:** `docs/design-references/traveliun/routes/customers.png`
- **Interaction model:** presentational search, add, filters, pagination.

## DOM Structure
- Optional filter card.
- Data table card.
- Search box.
- Optional legend chips.
- Add button.
- Scrollable table.
- Pagination/footer.

## Computed Styles
- Table header background: `#185045`.
- Header text: white, uppercase, 12px.
- Row text: muted green.
- Row separators: dashed light green-gray.
- Search input background: pale green-gray.
- Add button: `#185045`, white.

## States & Behaviors
- Table scrolls horizontally on narrow screens.
- Add and pagination buttons are visual placeholders.

## Responsive Behavior
- Desktop: full-width table.
- Mobile: content card stays within viewport and table scrolls horizontally.
