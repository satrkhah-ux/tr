# TraveliunSignIn Specification

## Overview
- **Target file:** `src/components/traveliun/TraveliunSignIn.tsx`
- **Screenshot:** `docs/design-references/traveliun/desktop-1440.png` before login
- **Interaction model:** click-driven mock login.

## DOM Structure
- Two-column full viewport page.
- Left: logo and login card.
- Right: background photo.

## Computed Styles
- Body background: white.
- Logo width: about 300px visually including Arabic/English mark.
- Card width: about 500px, white, soft shadow.
- Labels: dark green, required star red.
- Inputs: 47px tall, rounded border.
- Login button: `#185045`, 50px tall.

## Assets
- Logo: `public/traveliun/logo-en.svg`.
- Background: `public/traveliun/auth-background.webp`.

## Responsive Behavior
- Desktop: 50/50 split.
- Mobile: background hidden; centered form.
