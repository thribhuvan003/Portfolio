# Implementation notes

## 2026-11-22: Focused windows losing scroll position

- Geometry and animation fixes alone did not prevent window content from being recreated when focusing another panel.
- Stable loop keys preserved the DOM nodes, but reordering the focused subtree could still reset its scroll position.
- Keep window DOM order fixed and use z-index for stacking, in addition to stable loop keys. Browser verification preserved a 200px scroll position through focusing and closing another window.
- When testing window motion, check DOM identity and scroll position as well as the final coordinates.
