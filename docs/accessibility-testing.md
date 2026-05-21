# Accessibility Testing

Run automated checks before merging focus, form, navigation, or layout changes:

```sh
bun run check
bun run test:a11y
```

`bun run test:a11y` covers:

- `@axe-core/playwright` route checks for `/`, `/search`, `/learn`, and `/admin/login`.
- A Playwright keyboard traversal check that asserts focused homepage controls expose a visible indicator.
- `pa11y-ci` WCAG smoke coverage for the same public routes.
- Lighthouse Accessibility audits for the same public routes, with reports written to `.cache/lighthouse-a11y`.

Manual release checks:

- Use axe DevTools on the landing/search flow, address autocomplete, email verification/OTP flow, learn pages, and admin login.
- Use WAVE for quick visual inspection of focus order, color contrast, form labels, and landmark structure.
- Test keyboard-only navigation with Tab, Shift+Tab, Enter, Space, Escape, and arrow keys where relevant.
- Confirm focus is always visible, not clipped, and not obscured by dropdowns, rounded containers, or animated fields.
- Test VoiceOver on macOS with Safari or Chrome.
- Test NVDA on Windows with Firefox or Chrome.
- Confirm screen reader announcements match the visible focus location and the control purpose.
- Confirm RentForm address, rent, lease, email, form-level, and verification-code errors are announced and included in each invalid control's description.
