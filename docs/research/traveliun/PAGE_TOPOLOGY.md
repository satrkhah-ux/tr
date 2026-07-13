# Traveliun Page Topology

## Routes Inspected
- `/sign-in`: split authentication screen with logo/form and Riyadh background image.
- `/dashboard`: dashboard title, Arabic notice, filter panel.
- `/kanban-board`: kanban pipeline with offer cards.
- `/customers`: customer/person table.
- `/employees`: employee table.
- `/countries`: country management table.
- `/hotels`: country/city filter plus hotel table.
- `/services`: service-country connection table.
- `/visas`: visa pricing/requirements table.
- `/web-guide`: guide categories and document links.
- Several original nav entries route to `/404`; clone marks those as "Coming soon".

## Persistent Layout
- `TraveliunShell`
- Left icon rail
- Top header
- Main content slot
- Global warning: "هذا النظام ما زال تحت التجربة الرجاء تدقيق العروض يدوياً في البداية"

## Primary Components
- `TraveliunSignIn`
- `TraveliunShell`
- `TraveliunDashboard`
- `TraveliunDataPage`
- `TraveliunKanban`
- `TraveliunGuide`
- `TraveliunNotReady`

## Content Model
- AI-friendly structured records live in `src/lib/traveliun-data.ts`.
- Each table page is described by route, title, columns, rows, filters, and optional legends.
