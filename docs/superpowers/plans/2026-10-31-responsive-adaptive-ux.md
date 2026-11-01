# Responsive Adaptive UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one Vue/PWA codebase that delivers best-in-class touch and desktop UX across phone, tablet, and PC for every product surface, per the approved spec.

**Architecture:** Shared `useViewport()` drives layout; station chrome (`AppStationChrome`) shows bottom nav outside Base; `BaseShellView` becomes face-first (data/form/automation/dashboard/analysis) with filtered object lists; `GridPanel` swaps Canvas for `RecordListView` + `RecordDetailSheet` on phone (DOM compact table optional); other panels get phone sheets without new APIs.

**Tech Stack:** Vue 3, Vue Router, existing Canvas grid, Vitest, Playwright (mobile viewport), CSS custom properties + `@media`.

**Spec:** `docs/superpowers/specs/2026-10-31-responsive-adaptive-ux-design.md`

## Global Constraints

- Breakpoints: phone `<768`, tablet `768–1099`, desktop `≥1100` (spec §4).
- No native apps; no WeCom login; collab/offline protocols unchanged.
- Full feature parity on phone including field/schema tools (D5); one-shot delivery (D3).
- Deep link: `face`, `oid`, `formMode` query keys (spec review patch).
- Do not commit `.env` secrets; commits only if the human asks (session rule overrides plan commit steps — skip commit steps unless requested).

## Review Focus

1. Resize across 767↔768 and 1099↔1100 must remount the correct grid stage without losing selection/query — covered in Task 1 + 4 tests.
2. Entering Base must hide station bottom nav; leaving must restore — Task 2/3.
3. Form「收集结果」only under form face, not data face — Task 3.
4. Phone record edit must go through existing commit/collab path (no silent local-only) — Task 4.
5. Desktop Playwright suite must stay green after face-tab IA — Task 8.

---

### Task 1: Viewport composable + tokens + MobileSheet

**Files:**
- Create: `apps/web/src/composables/useViewport.ts`
- Create: `apps/web/src/composables/useViewport.spec.ts`
- Create: `apps/web/src/components/MobileSheet.vue`
- Modify: `apps/web/src/styles.css` (add `--bp-*`, safe-area utilities, `.touch-target`)

**Interfaces:**
- Produces: `useViewport(): { width: Ref<number>; mode: ComputedRef<'phone'|'tablet'|'desktop'>; isPhone: ComputedRef<boolean>; isTablet: ComputedRef<boolean>; isDesktop: ComputedRef<boolean> }`
- Produces: `MobileSheet` props `{ open: boolean; title?: string }` emits `close`

- [ ] **Step 1:** Write `useViewport.spec.ts` asserting mode for widths 390→phone, 800→tablet, 1200→desktop; threshold 767→phone, 768→tablet, 1099→tablet, 1100→desktop.
- [ ] **Step 2:** Run `pnpm --filter web exec vitest run src/composables/useViewport.spec.ts` — expect FAIL.
- [ ] **Step 3:** Implement `useViewport` with `matchMedia` listeners for `(max-width: 767.98px)` and `(max-width: 1099.98px)`; default desktop when `window` missing.
- [ ] **Step 4:** Add CSS tokens and `MobileSheet.vue` (fullscreen sheet on phone, dialog-sized on tablet+).
- [ ] **Step 5:** Re-run vitest — PASS.

---

### Task 2: Station bottom nav + MeView

**Files:**
- Create: `apps/web/src/components/StationBottomNav.vue`
- Create: `apps/web/src/views/MeView.vue`
- Modify: `apps/web/src/App.vue`
- Modify: `apps/web/src/router.ts` (route `/me` → MeView)
- Test: `apps/web/src/components/StationBottomNav.spec.ts` (mount logic: show iff authenticated && route not login/fill/view/dev/base)

**Interfaces:**
- Consumes: `useViewport`, `auth`, `route`
- Produces: bottom nav visible on `/`, `/notifications`, `/me`, `/admin/*`; hidden on `/workspaces/.../bases/...`, `/login`, `/fill`, `/view`, `/dev`

- [ ] **Step 1:** Spec test for `shouldShowStationNav(routeName, path, authed)`.
- [ ] **Step 2:** Implement helper + `StationBottomNav` + `MeView` (profile, logout, admin links).
- [ ] **Step 3:** Wire into `App.vue` with `padding-bottom` safe-area when nav shown.
- [ ] **Step 4:** Vitest PASS.

---

### Task 3: BaseShell face-first IA

**Files:**
- Modify: `apps/web/src/views/BaseShellView.vue` (major)
- Modify: related query sync if present
- Test: `apps/web/src/views/base-face.spec.ts` (pure functions for face↔sidebar filter + formMode)

**Interfaces:**
- Produces: `Face = 'data'|'form'|'automation'|'dashboard'|'analysis'`
- Produces: `filterSidebarItems(face, catalog)`; URL sync `face`/`oid`/`formMode`
- Automation becomes a first-class face (list in sidebar), not only topbar modal

- [ ] **Step 1:** Extract/test pure face helpers.
- [ ] **Step 2:** Refactor BaseShell template: face tabs; filtered sidebar; phone drawer toggle; hide duplicate automation-only entry or redirect into face.
- [ ] **Step 3:** Form face submodes design|results.
- [ ] **Step 4:** Vitest PASS; smoke open app in browser if available.

---

### Task 4: Phone RecordListView + RecordDetailSheet

**Files:**
- Create: `apps/web/src/components/RecordListView.vue`
- Create: `apps/web/src/components/RecordDetailSheet.vue`
- Create: `apps/web/src/composables/recordSummary.ts` (+ spec)
- Modify: `apps/web/src/components/GridPanel.vue`
- Reuse field editors from CanvasGrid/FormFieldControl where practical

**Interfaces:**
- Consumes: same records/fields/query/commit emits as GridPanel↔BaseShell
- Produces: `pickSummaryFields(fields, viewCols, max=3)`; list opens detail; detail commits cell updates via existing emit

- [ ] **Step 1:** Unit test `pickSummaryFields` (title field first, else first non-system).
- [ ] **Step 2:** Implement list + detail; GridPanel `v-if="isPhone && layoutMode==='list'"` vs Canvas.
- [ ] **Step 3:** Multi-select bar + add row on phone.
- [ ] **Step 4:** Vitest PASS.

---

### Task 5: Compact table + tablet canvas affordances

**Files:**
- Create: `apps/web/src/components/CompactRecordTable.vue`
- Modify: `GridPanel.vue` (mode toggle list|compact on phone)
- Modify: `CanvasGrid.vue` / engine touch hit padding when `isTablet`

- [ ] **Step 1:** Compact table DOM + cell → detail/editor sheet.
- [ ] **Step 2:** Tablet: slightly larger row/col hit targets via options prop.
- [ ] **Step 3:** Manual/vitest smoke where feasible.

---

### Task 6: Form / Automation / Dashboard / Analysis phone layouts

**Files:**
- Modify: `FormBuilderPanel.vue`, `AutomationPanel.vue`, `AutomationEditor.vue`, `DashboardPanel.vue`, `AnalysisReportPanel.vue`
- Replace ad-hoc `@media` with `useViewport` classes / MobileSheet

- [ ] **Step 1:** Form builder single-column + sheet field config on phone.
- [ ] **Step 2:** Automation list→fullscreen editor on phone.
- [ ] **Step 3:** Dashboard single-column stack + config sheet; analysis readable stack.
- [ ] **Step 4:** Smoke each panel at 390 width.

---

### Task 7: Home / Login / Notifications / Admin / PublicView / FormFill polish

**Files:**
- Modify: `HomeView.vue`, `LoginView.vue`, `NotificationsView.vue`, `Admin*.vue`, `PublicViewView.vue`, `FormFillView.vue`
- Migrate `860/640` media to shared breakpoints

- [ ] **Step 1:** Home uses phone/tablet tokens; members stay on home.
- [ ] **Step 2:** Admin card lists on phone; keep bottom nav.
- [ ] **Step 3:** PublicView phone list (reuse RecordListView read-only or parallel simple list).
- [ ] **Step 4:** FormFill safe-area polish.

---

### Task 8: E2E phone suite + docs + desktop regression

**Files:**
- Create: `apps/web/e2e/responsive-phone.spec.ts`
- Create: `docs/RESPONSIVE.md`
- Modify: Playwright config if needed for projects

- [ ] **Step 1:** Phone project tests: station nav; enter base hides nav; list edit commit; form face; automation open; dashboard open.
- [ ] **Step 2:** Run phone e2e + existing desktop subset; fix failures.
- [ ] **Step 3:** Write `docs/RESPONSIVE.md`; mark plan tasks done.

---

## Spec coverage map

| Spec | Task |
|------|------|
| §4 breakpoints / useViewport | 1 |
| D2/D7/D8 station shell | 2 |
| D6 Base face IA | 3 |
| D1/D5 data phone list+detail+structure entry | 4–5 |
| §6.2–6.5 panels | 6 |
| §6.3/6.6/6.7 | 7 |
| §8–9 acceptance | 8 |
