# Paperuss Floating Toolbar Design System

These rules govern ALL floating/overlay toolbars in Paperuss (embed cards, media cards,
link cards, callout cards, image widgets, or any hover/touch action bar).

## 1. Shape & Surface (Proforma Standard)
- Single **unified pill strip** — `border-radius: 12px !important`, padding `4px 8px`, gap `4px`
- Background: `rgba(18, 24, 38, 0.95)` dark / `rgba(255, 255, 255, 0.96)` light + `backdrop-filter: blur(16px) saturate(180%)`
- Border: `1px solid rgba(255, 255, 255, 0.12)` dark / `rgba(0, 0, 0, 0.12)` light — crisp metallic hairline
- Shadow: `0 6px 20px rgba(0, 0, 0, 0.35)` dark / `0 4px 16px rgba(0, 0, 0, 0.08)` light
- Position: `top: 0; transform: translateX(-50%) translateY(-100%); left: 50%` — flush above card/image, **zero vertical gap**

## 2. Buttons — Icon-Only, No Chevrons, No Labels
- All action buttons are **icon-only** using Lucide icons at `w-4 h-4` (16px)
- NO chevron-down arrows on dropdown-trigger buttons
- NO text labels on buttons (use `title` attribute for tooltip only)
- Button dimensions: height `26px`, min-width `26px`, padding `0 6px`, `border-radius: 6px !important`
- Default icon color: `rgba(255, 255, 255, 0.7)` dark / `#64748b` light
- Hover: `background: rgba(255, 255, 255, 0.12)` dark / `rgba(0, 0, 0, 0.05)` light, icon brightens to `#ffffff` / `#0f172a`

## 3. No Dividers
- **Never** render vertical hairline dividers between button groups
- The strip is a single continuous, borderless bar

## 4. Accent Color Awareness & Micro-Shadow
- Active/selected button states MUST use CSS custom properties:
  - Background: `var(--accent-soft) !important`
  - Icon/text color: `var(--accent) !important`
  - Font weight: `600`
  - Micro-shadow: `box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08)`
- Hardcoded colors are forbidden for active states — tokens auto-sync with user theme

## 5. Dropdown Menus (when needed)
- Trigger by tapping the icon button directly (NOT a separate chevron)
- Direction: vertically below the triggering button
- Surface: same glassmorphism tokens as the toolbar
- **Mutual exclusion**: opening one dropdown auto-closes all siblings
- **Selection persistence**: selecting an option updates UI in real-time WITHOUT closing the dropdown
- **Close only on explicit outside click**: close when user clicks outside the toolbar container

## 6. Touch Focus Guard (required on all card/image toolbars inside contenteditable)
Every toolbar rendered inside a `contenteditable` region MUST prevent caret jump on touch.

CSS on the container:
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  caret-color: transparent;
  touch-action: manipulation;

JS in the toolbar hydration function:
  const isInteractiveTarget = (el) =>
    el && el.closest('button, a, input, select, textarea, [contenteditable="true"]');

  card.addEventListener('pointerdown', (e) => {
    if (!isInteractiveTarget(e.target)) e.preventDefault();
  });
  card.addEventListener('touchstart', (e) => {
    if (!isInteractiveTarget(e.target)) e.preventDefault();
  }, { passive: false });

## 7. Hover & Visibility Behavior
- **Desktop Hover Reveal**: Toolbar fades in (`opacity: 1`, `transition: opacity 0.18s ease`) on `mouseenter` / `pointerenter` over the target card or image.
- **Mouse Leave Hiding**: Moving the mouse off both target element and toolbar hides the bar smoothly (`opacity: 0`).
- **Persistence Exceptions**: Toolbar MUST remain visible if:
  1. An inner dropdown menu (`Size`, `More ⋮`, etc.) is currently open.
  2. The target element is explicitly clicked / selected (`selectedImg` or active card).
- **Touch/Mobile**: Toolbar is always visible on selection/tap — never relies on hover.
- **Contenteditable Integrity**: Toolbar MUST set `contenteditable="false"` to prevent document model pollution.

## 8. Destructive Actions
- Delete/Remove buttons must be the **rightmost** slot with a faint `var(--danger)` tint
- Must have a `title="Remove ..."` tooltip and optionally a confirmation toast

## 9. Button Ordering Convention (left to right)
1. Size / layout control
2. Primary edit action (e.g. Crop)
3. Fullscreen / Lightbox preview
4. Card cover / primary context assignment
5. More context menu (vertical dots ⋮)
6. Remove / delete (rightmost, danger)

## 10. Crisp HD Rendering & Subpixel Optimization (Mandatory)
All floating toolbars MUST enforce HD vector rendering and hardware-accelerated compositing:

```css
.my-floating-toolbar {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  transform: translateZ(0); /* Force GPU compositing layer */
}
```

- **Hairline Border Rim**: Always use `1px solid rgba(255, 255, 255, 0.12)` in dark mode and `rgba(0, 0, 0, 0.12)` in light mode for ultra-sharp edge definition.
- **Integer Pixel Rounding**: JS-positioned overlays MUST pass coordinates through `Math.round()` so top/left values never land on fractional subpixels (which causes edge blurring).
