# Kurio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Build the complete responsive Kurio challenge from the archived Figma/PDF, with real network-layer simulations and reproducible validation.

**Architecture:** Vite SPA, typed REST via Axios, TanStack Router/Query, persistent MSW domain and protocol-compatible Socket.IO simulation. Shared domain contracts separate backend simulation from presentation. Assets and fonts are served locally.

**Tech Stack:** React, TypeScript, TanStack Router/Query, Axios, Socket.IO, Tailwind, shadcn/ui, MSW, Playwright, Lighthouse; Vitest for meaningful domain verification.

**Spec:** docs/superpowers/specs/2026-11-17-kurio-marketplace-design.md

## Global Constraints

- Portuguese copy and visual identity match the archived references in design-reference/.
- Effective use of every mandatory technology; no UI-level substitute for REST or Socket.IO.
- ETH decimals use integer arithmetic; API values are decimal strings.
- Authenticated data is isolated; guest cart survives login; private subscriptions clear on logout.
- All routes work on refresh; public demonstration uses the same mocks and assets as local development.
- Failures, expiry, idempotency, socket replay/reconnect and checkout revalidation are testable.
- Layouts validated at 390, 768 and 1440 px; E2E and visual baselines are included.

## Review Focus

- Session expiry during checkout must preserve intent without leaking the previous user's data.
- Timeouts after order creation must retrieve the original order instead of buying twice.
- Socket events older than REST state must not regress prices or final order states.
- Guest/login cart merging must preserve quantities while respecting edition stock.
- Refresh and back/forward must restore combined catalogue filters and pending orders.

## Tasks

### Task 1: Shared application foundation (root)

Files: package/config, src/domain/types.ts, src/lib/{api,hooks,auth,realtime,money,utils}.ts(x), src/components/ui/, src/app/, src/styles.css, public/assets/.
Interfaces: types.ts is the binding contract. API paths and hooks are defined in the worker briefs under .superpowers/sdd/kurio/.

- [x] Establish toolchain, locally optimized assets, shadcn primitives, router and typed API/hooks.
- [x] Write failing precision/session/realtime behavior tests before domain code; run Vitest red/green.
- [x] Integrate the three independently owned feature areas, typecheck and browser smoke checks.

### Task 2: Persistent mock backend and Socket.IO (worker backend)

Files: src/mocks/**, tests/unit/backend*.test.ts; no shared domain edits without coordination.
Interfaces: src/domain/types.ts; startMocks():Promise<void> from src/mocks/browser.ts.

- [x] Define deterministic fixtures, two hashed-password users, session and per-user storage.
- [x] Test precision, cart merge, idempotent orders, receipt immutability and event versions before implementing them.
- [x] Implement REST handlers, configurable failures and real socket.io-client-compatible MSW transport.
- [x] Verify isolated unit tests and document exact REST/control contracts in worker report.

### Task 3: Catalogue, detail and public layouts (worker storefront)

Files: src/features/catalog/**, src/features/nft/**, src/components/layout/**, src/styles/storefront.css.
Interfaces: useCatalog/useNft/useCart/useCartActions/useFavorites/useToggleFavorite/useAuth from src/lib; Artwork and CatalogSearch from types.ts.

- [x] Recreate header, hero, sidebar, cards, editorial section, footer and mobile navigation from local reference.
- [x] Implement filters/history via Router, detail gallery/editions/favorite and add-to-cart with network states.
- [x] Verify responsive sizes and interactive controls; report UI assumptions and test evidence.

### Task 4: Account and purchase (worker account)

Files: src/features/{auth,account,cart,checkout}/**, src/styles/account.css.
Interfaces: root auth/hooks/api/primitives plus types.ts; named page exports specified in brief.

- [x] Implement modal/full-page login and registration, protected return paths, profile and wallets.
- [x] Implement cart/coupon, quote review, wallet selection, pending/rejected/confirmed order and persisted idempotent recovery.
- [x] Validate inputs and accessible errors/focus with reference-matching desktop/mobile presentation.

### Task 5: End-to-end verification, documentation and delivery (root + reviewer)

Files: tests/e2e/**, playwright.config.ts, scripts/lighthouse.mjs, lighthouse/**, README.md, ARCHITECTURE.md, hosting rewrite config.

- [x] Run executable E2E through MSW and Socket.IO for all twelve challenge scenario groups: final70/70PASS on production, default1worker.
- [x] Capture/review visual baselines for home, detail, cart and checkout on desktop/mobile: final8/8PASS.
- [x] Run typecheck, lint, unit tests and optimized build; fix regressions before completion:42unitPASS, lint/types/buildPASS.
- [x] Audit home/detail three times per device, save HTML/JSON reports and medians; document mobile Performance below90 rather than claim target met.
- [x] Conduct independent code review and prepare deployable source/documentation. NoImportant/Critical open; one minor mobileminheight observation deferred/documented.
- [ ] Publish public application/repository when destination and external-transfer authorization are available. Sites source sync was rejected by automatic approval; no workaround attempted.

## Execution rulings

User explicitly requested implementation after reviewing the design and completed offline archive. Proceed without additional design/plan approval pauses. The workspace is a new project, not an existing Git checkout; work directly here. Independent workers have disjoint file ownership and may run concurrently to comply with the active delegation instructions. Root owns package/lockfile, shared contracts and integration; workers do not commit or install packages concurrently.
