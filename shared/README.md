# shared/

Platform-agnostic code used by both the Next.js dashboard (`web/`) and the
future Expo cashier app (`mobile/`).

Rules for anything placed here:
- No React, no DOM, no Next.js imports
- No `window`, `document`, or Node-only APIs
- Pure TypeScript: types, math, validation, constants

| Folder | Contents |
| --- | --- |
| `types/` | Database row types, generated from the live Supabase schema |
| `lib/` | Pricing math, payroll calculation, currency formatting |
| `constants/` | Enums, service categories, role names |
