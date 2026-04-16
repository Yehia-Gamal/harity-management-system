# CSS Refactor Notes

## Current State

- Main stylesheet: `assets/css/style.css`
- Current loading path: `charity-management-system.html`
- The app relies on a single CSS file today, so splitting CSS before visual checks would be risky.

## Conservative Organization Strategy

1. Keep `style.css` as the production-loaded file for now.
2. Maintain a section map at the top of `style.css`.
3. Extract only after visual smoke checks are available.
4. Suggested future files:
   - `foundation.css`
   - `navigation.css`
   - `components.css`
   - `cases.css`
   - `settings-users.css`
   - `reports.css`
   - `responsive.css`

## Immediate Cleanup Targets

- Normalize duplicate `.modal` and `.modal-card` sections.
- Normalize repeated button variants.
- Review case card and settings card spacing.
- Keep RTL readability and Arabic labels as-is.

## Acceptance Checks Before Splitting

- Login screen renders.
- Main navigation renders on desktop and mobile.
- Case cards render without overlap.
- Case details modal opens and scrolls correctly.
- Import modal opens and closes correctly.
- User management modal opens and remains keyboard usable.
