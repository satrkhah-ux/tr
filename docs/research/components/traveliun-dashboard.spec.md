# TraveliunDashboard Specification

## Overview
- **Target file:** `src/components/traveliun/TraveliunDashboard.tsx`
- **Screenshot:** `docs/design-references/traveliun/desktop-1440.png`
- **Interaction model:** static filter form.

## DOM Structure
- `TraveliunShell`
- White filter card.
- Date range field.
- Employee select.
- Country select.
- Apply button.

## Computed Styles
- Card background: white.
- Card border radius: ~6px.
- Shadow: subtle gray drop shadow.
- Inputs height: 47px.
- Button background: `#185045`, color white, border radius ~7px.
- Labels: 13px, dark green.

## Text Content
- Date
- To
- Employee
- Select
- Country
- Apply

## Responsive Behavior
- Desktop: three-column filter row, centered apply button.
- Mobile: stacked fields; apply button keeps clear width.
