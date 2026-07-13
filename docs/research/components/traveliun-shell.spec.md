# TraveliunShell Specification

## Overview
- **Target file:** `src/components/traveliun/TraveliunShell.tsx`
- **Screenshot:** `docs/design-references/traveliun/desktop-1440.png`
- **Interaction model:** click-driven sidebar/mobile menu.

## DOM Structure
- Root admin layout.
- Fixed sidebar icon rail.
- Fixed top header with page title, warning notice, action icons, profile block.
- Main content area.

## Computed Styles
- Font family: `Inter, Tajawal, sans-serif`.
- Primary green: `rgb(24, 80, 69)` / `#185045`.
- Secondary green text: `rgb(74, 102, 74)`.
- Header/card background: `rgb(255, 255, 255)`.
- Border color: `rgba(139, 69, 19, 0.16)` and light green-gray borders.
- Sidebar width: 74px desktop.
- Header height: about 74px desktop.

## States & Behaviors
- Mobile menu opens from hamburger.
- Active route highlights current sidebar item.
- Icon hover transitions color/background over ~0.2s.

## Assets
- Logo: `public/traveliun/logo-en.svg`.

## Responsive Behavior
- Desktop: fixed icon rail plus content margin-left.
- Mobile: no fixed rail; menu opens as sheet, content begins below compact header.
