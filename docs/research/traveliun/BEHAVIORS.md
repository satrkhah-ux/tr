# Traveliun Behaviors

## Global
- Authenticated dashboard redirects from `/sign-in` to `/dashboard` after valid credentials.
- System is mostly static CRUD/admin UI with sidebar navigation and data tables.
- Dominant interaction model: click-driven navigation, dropdown filters, table pagination, search fields, and add buttons.
- No scroll-driven animation was observed in the inspected pages.

## Header
- Fixed at top of content area.
- Desktop: starts after the 74px left sidebar and spans the remaining width.
- Mobile: full width, left hamburger, compact Arabic notice, icon actions.
- Toolbar icons open menus in the original app. Clone keeps visual buttons and lightweight mock state only.

## Sidebar
- Desktop: fixed 74px icon rail with active item background.
- Mobile: hidden by default, opened with hamburger into an overlay drawer.
- Original hover/click expands menu text in flyouts. Clone exposes clear navigation labels in the mobile drawer and keeps icon rail on desktop.

## Dashboard Filter Card
- Static form controls: date range, employee select, country select, apply button.
- Mobile: fields stack vertically; original button overflows slightly at 390px. Clone keeps the same visual weight but constrains width to avoid broken text.

## Tables
- Search filters are client-side visual controls.
- Pagination buttons are presentational.
- Rows use dashed separators and green text.
- Add buttons are visual entry points for future CRUD forms.

## Kanban
- Horizontal columns with offer cards.
- Interaction model in this clone: static board with representative statuses and cards.

## Responsive
- 1440px: sidebar icon rail, full header, wide cards/tables.
- 768px: layout remains desktop-like with reduced table viewport.
- 390px: top bar becomes compact, content cards stack, data tables scroll horizontally.
