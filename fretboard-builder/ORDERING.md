# Future: customers order the fretboard they designed

**Status: not enabled.** Nothing in this branch changes Stripe, products, Cloud Functions or Firestore.
What exists today is the groundwork: every design is a versioned JSON document (`design-config.js`),
shareable by URL, with a stable `designId` (SHA-256 of its canonical JSON) and a hidden, disabled
**Order this fretboard** button (`#fb-order`, gated by `FretboardDesign.ORDERING_ENABLED = false`).

This is how it would plug into the existing cart → `/api/checkout` → Stripe Checkout → webhook → Firestore flow.

## 1. What the customer does
1. Designs a board on `fretboard-builder.html`, picks a material (PLA / PETG) and clicks **Order this fretboard**.
2. A cart line is added (the drawer opens like it does for the pickup) showing a short summary
   ("4-string · 23.5″ scale · 2 pieces") and a link back to that exact design.
3. Checkout runs through the existing backend Checkout Session flow. The design rides along with the order;
   Mike gets the design and prints/fulfils it.

## 2. Catalog (`functions/data/catalog.json`, then `npm --prefix functions run catalog:build`)
- Add a product `custom-fretboard` with variants such as `pla` and `petg`, each with its own Stripe Price
  (`unitAmountCents`, e.g. 8000) exactly like the pickup's `standard` variant.
- Add a flag such as `"design": "mjg.fretboard-design@1"` so the server knows this product needs a design.
- Price stays server-side and fixed per variant; the design never sets the price. (If price ever depends on
  the design, e.g. 3 pieces vs 1, compute it on the server from the design, never from the browser.)

## 3. Browser (`js/site.js` + `fretboard-builder/store-page.js`)
- Cart line today: `{ id, name, price, variantId, qty, image }`. A custom line adds
  `{ designId, design }` (the normalized config, ~600 bytes). `FretboardDesign.proposedCartLine()` already
  builds this shape.
- `Cart.add` merges lines by `id` only today; it must merge by `id + variantId + designId`, so two different
  boards are two lines and the same board twice is qty 2.
- `backendCheckout()` sends `{ productId, variantId, qty, design }` for custom lines (the server recomputes
  `designId`; it never trusts the browser's).
- Cart image: a small PNG of the preview canvas, or a generic fretboard photo.
- **Ordering needs `CHECKOUT_MODE='backend'`.** Legacy Payment Links are one fixed product each and can't carry a design.
- Turn on: set `ORDERING_ENABLED = true` in `design-config.js` (store-page.js then shows/enables the button)
  and replace the `not_implemented` branch of `requestOrder()` with the cart add.

## 4. Server (`functions/src/`)
- `cartValidate.js`: `LINE_KEYS` only allows `productId, variantId, qty`. Allow `design` **only** for products
  flagged as needing one, and require it there. Validate it with the same `design-config.js`
  (`normalize()` must return **zero warnings**: strict mode), then recompute `designId`. Aggregate lines by
  `product + variant + designId` instead of `product + variant`. Cap custom lines per order (e.g. 5).
- Optional but cheap: run `Fretboard.buildFretboard(FretboardDesign.toBuildParams(...))` in the function to
  reject a design the engine can't build, and record piece count/lengths. (Functions would need the engine +
  `design-config.js` inside `functions/`, e.g. copied by the sync script; Hosting and Functions deploy from different folders.)
- `checkout.js` → `snapshotLines()`: add `designId` and a short `designSummary` to each custom line, and store
  the full designs on the order: `orders/{orderRef}.designs = { [designId]: config }` (each ~600 B; far under
  Firestore's 1 MiB doc limit). `cartFingerprint()` must include `designId` so a different design is a different cart.
- Stripe line items: today each line is `{ price, quantity }` and the webhook matches lines **by Stripe Price ID**
  (`verifyPaidSession` rejects `duplicate_price`). Two different custom boards would share a price, so custom lines
  should use `price_data` (amount from the catalog, `product_data.name` = the design summary,
  `product_data.metadata.design_id`) and the webhook should match custom lines by `design_id` + amount instead
  of by price ID. Keep the pickup's existing matching unchanged.
- Stripe session `metadata` stays small (`store_id`, `order_ref`, `catalog_version`); the design itself lives in
  Firestore, not in Stripe (metadata values are capped at 500 characters).
- `maxBodyBytes` is 8192: 5 designs ≈ 3 KB, so it's fine as is.

## 5. Fulfilment
- After the webhook marks the order `paid`, the order doc has the shipping address (from Stripe) and
  `designs`. Mike opens `fretboard-builder.html#design=<encoded>` (store this link on the order) and downloads
  the STL, the same file the customer saw.
- Engine drift: each design records `engine` (e.g. `fretboard-builder@fe04491`). Tag upstream releases so an
  old order can be rebuilt with the exact engine it was designed on if geometry changes in between.
- Don't accept browser-uploaded STLs as the source of truth (multi-MB, untrusted, too big for Firestore).
  If a stored STL is wanted, generate it server-side from the design into Cloud Storage after payment.
- If printing is outsourced later, the same paid-order hook can send the regenerated STL to a print service
  (e.g. Slant3D's API) instead.

## 6. Before turning it on
- Stripe Price(s) for the custom product in test mode, then live; E2E test like the pickup's.
- Shipping/lead-time copy ("made to order, ships in N days"), returns policy for custom items (FAQ).
- Order notification to Mike (email from the webhook) so new custom orders aren't missed.
