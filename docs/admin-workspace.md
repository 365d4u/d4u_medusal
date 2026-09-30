# Admin workspace, 2026-09-29

The product detail page now groups the existing Medusa sections into General,
Media, Options & variants, Shipping & channels, 365D content and Advanced tabs.
Native loaders, permissions and the modal route outlet remain in use.
Registered product widgets are preserved in 365D content.

General now has one inline form for title, description, subtitle, handle,
material, discountability, status, categories, tags, type and collection. Its
sticky Save changes button calls the native product update mutation once with
only the changed fields. Native query invalidation refreshes the title and saved
product. Searchable, paginated classification pickers retain selected entries.
Switching product tabs preserves the draft. Failed saves retain input; Discard
changes resets to the last server values. Read-only staff cannot edit the form.
Deploying this UI does not rewrite product data.

Store settings uses separate payment-method, payment-account and website tabs.
Website records and payment providers use a secondary section menu. Draft values
survive tab switches. Saving one website record refreshes only that record so
other unsaved records remain intact. Payment secrets remain blank in the form
and retain their existing server-side keep-on-empty behavior.

Email templates use a template menu and editor; log, review moderation,
import/export, product content and staff access use the same compact form styles.
Automatic Feishu access rules and all existing API authorization are unchanged.
This adapts the custom configuration screens; it does not replace every native
Medusa Settings route.

## Build boundary

`src/lib/admin-workspace-vite.ts` in the backend adapts the pinned Medusa dashboard
2.18.0 product composition during the build. It does not modify node_modules.
Like the existing staff/Orders adapter, the build fails if the expected component
boundary changes. Review both adapters before upgrading Medusa.

Build with `medusa build --admin-only` from apps/backend. The resulting
`.medusa/admin` directory is deployed to the existing server's public/admin path.

## Verification

- Backend TypeScript check and admin build passed.
- `node scripts/check-admin-workspace.cjs` serves the actual built dashboard on
  loopback with a fixture API. All non-loopback browser requests are blocked.
- It checks native product tabs, the original Edit product dialog, draft retention,
  saving product content, preserving another website draft during save, empty
  payment-secret submissions, email-template saves and keyboard tab navigation.
- Inline General checks cover a failed save and retry, reload after saving,
  categories/tags/types/collections, clearing optional values, changed-only
  payloads, discarding a draft and read-only staff behavior.
- Screenshots checked at 1440, 768 and 390 pixels; no page overflow or browser
  exceptions. Reports and screenshots: `.private/admin-workspace/`.
- The save tests write only fixture memory. They do not change real payment
  configuration or send email. Live authenticated staff operations are not
  asserted by this isolated test.

## Test deployment

`scripts/deploy-admin-workspace.py` checks the test environment, backs up affected
sources and admin assets, checks reviewed source hashes, uploads only UI sources
and assets, and verifies the published HTML and backend health. Old hashed assets
are retained for already-open browser tabs. No database migration, environment
rewrite, storefront deployment or payment setting update is performed.

Deployment output and backup location: `.private/admin-workspace-deployment/report.json`.
