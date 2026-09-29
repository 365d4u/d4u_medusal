# 365D4U Medusa migration

Migration from the existing WordPress / WooCommerce store to a standalone Medusa v2 backend and storefront.

## Production environment

- Storefront: https://medusa.365d4u.com/
- Medusa Admin: https://medusa.365d4u.com/app/
- Invoice builder: https://medusa.365d4u.com/invoices/new/
- The custom365d.com domain switch was canceled; production continues on medusa.365d4u.com.
- Deployment and rollback notes: [production deployment](docs/production-deployment.md).

## Test environment

- Storefront: https://testmedusa.365d4u.com/
- Medusa Admin: https://testmedusa.365d4u.com/app/
- Runtime: Medusa 2.18.0, Node.js 20, PostgreSQL and dedicated Redis.
- Deployment: `/var/www/d4u_medusa`; services `d4u-medusa-backend`, `d4u-medusa-storefront`, `d4u-medusa-redis`.
- Local administrator access is in `.private/admin-access.json` (ignored by version control).

PayPal and Oceanpayment sandbox payments have been captured and reconciled with Medusa orders. Apple Pay remains disabled on the test domain at the owner's request. See [verification and remaining work](docs/acceptance.md).

## Migration status

The test deployment and core commerce are working. Full frontend and business-behavior parity is still in progress; passing route smoke checks does not certify a complete replica. Historical WooCommerce orders are preserved in the dedicated WordPress order-history module, separate from new Medusa orders.

- Source checkout: `E:\c365\ecom365d4u`
- Production reference: https://www.365d4u.com/
- Test deployment directory: `/var/www/d4u_medusa`
- Credentials and raw migration exports belong outside version control.
- Test payment providers must use sandbox credentials. Existing production orders must never trigger new charges, notifications, or fulfillment jobs during import.

See `docs/source-audit.md` for verified findings and migration coverage.

WooCommerce order-list/detail, batch status and Respond/CRM creation compatibility routes were deployed to the Medusa production and test sites on 2026-09-26. Existing Medusa order numbers remain unchanged. See [compatibility configuration, historical data enrichment and rollout](docs/woocommerce-compatibility.md); the original WordPress domain and external callers have not been switched.

## Development and verification

1. Use Node.js 20 and run `npm install` at the root and in both `apps/backend` and `apps/storefront`.
2. Configure ignored `.env` files from the examples. Never commit credentials, raw customer exports or payment receipts.
3. Run `npm run dev:backend` and `npm run dev:storefront`; the backend requires PostgreSQL. Production also requires Redis.
4. Run `npm test` and `npm run build:backend`. Browser smoke checks are in `scripts/check-pages.cjs` and `scripts/check-mobile.cjs`.

### Generated storefront files

Captured page templates (the hash-named HTML files), `shell.html`, `routes.json`,
and `invoice-payment.html` are generated migration artifacts and are ignored by
Git. Downloaded fonts, WordPress assets, invoice reference assets, and the
Masonry / ImagesLoaded vendor copies are also ignored. The handwritten
`templates/invoice-builder.html` and application JavaScript / CSS remain source files.

Before starting or packaging a fresh checkout, restore the private migration
inputs (`.private/rendered/manifest.json` and its captured HTML files, plus
`.private/invoice-reference.html`) and install Python's `requests` and
`beautifulsoup4` packages. Run these commands from the repository root:

```sh
python scripts/prepare-storefront.py
python scripts/prepare-invoice-template.py
python scripts/prepare-parity-assets.py
```

Preparation downloads missing assets from the source sites; those sites must be
reachable. The final parity pass also localizes fonts in the invoice template.
These files are required at runtime and must still be included in deployment
packages. `npm install` and the backend build do not generate them.

`scripts/deploy-test.py --build --upload-only` packages built application files and writes the dedicated test configuration. It does not restart the application services. Restart only the two named application services after uploading; use `scripts/configure-nginx.py` only for this test virtual host. Initial imports, metadata refreshes and history imports are separate operations; a history reimport replaces imported review content and must not be run after new reviews are accepted without reconciliation.
# d4u_medusal
