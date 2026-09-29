# Source audit

Verified 2026-09-23 through local source inspection and read-only production SQL.

## Architecture

The production site uses WordPress, WooCommerce HPOS orders, a heavily customized Twenty Twenty-Five block theme, MyShop custom catalog APIs, home365d-config, customer-collect, custom365d-reviews, wc-global-policies, and woocommerce-365d4u-payment-control. The root `custom-api.php` dispatches catalog and page configuration requests. The HTML templates fetch these APIs from browser scripts.

Production content includes database overrides (`wp_template`, `wp_template_part`, `wp_navigation`, `wp_global_styles`). Copying the local theme alone cannot reproduce the live site.

Production has additional active customization modules absent from the initial local file listing: `home-fresh-drops` and `ready-to-ship-badge`. Deployed code and database content are therefore the final reference for parity.

## Initial counts

| Entity | Count |
| --- | ---: |
| Published pages | 37 |
| Published products | 794 |
| Draft products | 27 |
| Published variations | 3,634 |
| Attachments | 4,641 |
| Order placeholder posts | 52,878 |
| Published template overrides | 5 |
| Published template parts | 3 |

Order placeholder count is not an audited order import count. Actual orders live in WooCommerce HPOS tables and require separate reconciliation.

## Frontend families

- Home: `newHome.html`, homepage settings, banners, Fresh Drops, live sale, collections, reviews.
- Catalog: full-custom, semi-custom, ready-to-ship, list, search, category and tag filters, waterfall ads.
- Product: custom `/p/` and standard WooCommerce product routes, configurable materials/options, deposit prices, ready-to-ship inventory, imagery/video, policies and comments.
- Promotions: flash sale and live sale.
- Collections: wishlist, shared collection.
- Account: login/register/password reset, orders, wishlist, comments, support, addresses.
- Checkout: cart, customer/address/phone validation, shipping, PayPal, Oceanpayment card and Apple Pay, return routes and asynchronous payment notifications.
- Content: about, FAQs, contact, terms, privacy, shipping, refund, IP rights, trade-in, custom process, dental impressions, blog, timeline, SMS consent.

## Business behavior to preserve

- Deposits and full-price variants are distinct; use server-controlled prices.
- Product groups: full custom, signature/semi custom, ready-to-ship.
- Sale price validity and stock updates must be enforced server-side.
- Media may point to the existing authorized `img.365d4u.com` CDN.
- Historical orders, reviews and customers need stable legacy ID mapping and repeatable imports.
- Do not replay source cron jobs, outbound email, advertising events, Feishu or Respond writes during import.
- Payment return pages are not proof of payment. Signed webhooks/provider verification must drive status updates.

## Reference documentation

- https://docs.medusajs.com/learn/installation
- https://dev.oceanpayment.com/docs/payment/introduction
- https://dev.oceanpayment.com/docs/payment/embedded/integration
- https://dev.oceanpayment.com/docs/payment/methods/applepay
- https://dev.oceanpayment.com/docs/webhook/introduction

## Acceptance status

Source inventory and the core migration have been implemented. The test deployment has passed real sandbox captures for PayPal and Oceanpayment, route smoke checks and the data counts listed in `acceptance.md`. Full frontend parity and production acceptance remain open; see that document for specific gaps.
