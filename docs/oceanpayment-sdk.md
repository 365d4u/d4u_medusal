# Pinned Oceanpayment SDK

Source: https://secure.oceanpayment.com/pages/js/oceanpayment.js
Retrieved: 2026-09-23
Local asset: `/assets/vendor/oceanpayment-0e7a4e5cebd8.js`
SHA-256: `0e7a4e5cebd8ed74a73b579eb9c2844bb5ef6fae4a36780a720a3b8ff295264e`

The SDK is copied without modification. Its content-hashed filename permits a one-year immutable browser cache. Replace with a new hash filename when upgrading, update both the invoice template generator and payment script, and run the sandbox payment regression.

Public environment configuration is rendered in the invoice HTML. No separate `/api/config` request is needed. Private signing credentials remain on the backend. Card fields are served inside the provider iframe; their content must remain hosted by Oceanpayment. The iframe starts loading on page entry, before the payment method is selected.

Apple Pay SDK (unmodified): https://secure.oceanpayment.com/pages/js/oceanpayment-applepay.js
Local: `/assets/vendor/oceanpayment-applepay-b57c3ce46ca9.js`
SHA-256: `b57c3ce46ca96a1090b8a6fc07ed661242971af0dacad958c3c737b6af2010a6`
