# Michael James Guitars — storefront

Static site (plain HTML/CSS/JS, no build step) for selling handmade piezo bridge pickups for cigar box guitars. Hosted free on GitHub Pages; checkout via **Stripe Payment Links** (no server, no Shopify).

## Files
- `data/products.json` — **single source of truth** for products, prices, Stripe links, and the contact email.
- `assets/logo.svg` — logo (text placeholder). `assets/favicon.svg` — favicon.
- `assets/img/products/` — product photos.
- `index.html`, `shop.html`, `product.html?id=...`, `about.html`, `faq.html`, `contact.html`, `success.html`, `cancel.html`, `404.html`.
- Search the repo for `TODO` to find everything still to fill in.

## Edit products
Each entry in `data/products.json`:
```json
{ "id": "url-safe-id", "name": "...", "price": 15, "shortDescription": "...", "description": "...",
  "specs": { "Strings": "3" }, "installNotes": "...", "images": ["assets/img/products/x.jpg"],
  "stripeLink": "", "inStock": true }
```
Prices display as "$15 + shipping". Set `inStock: false` to show "Sold out". Also set `contactEmail` at the top.

### Photos
Put web-sized copies (~1200px wide JPG, under ~250 KB) in `assets/img/products/` and list them in `images` (first one is the main/card image). Quick resize: `mogrify -resize 1200x1200\> -quality 82 *.jpg` (ImageMagick).

## Add Stripe Payment Links (step by step)
1. Stripe Dashboard → **Product catalog → + Add product**. Name it, set a one-time price of **$15.00 USD**. Repeat per product.
2. Set up shipping: **Settings → Shipping rates** (or create one inside the Payment Link) → add a rate, e.g. flat "USPS First Class – $5.00", or several tiers (Standard / Priority) so customers pick one.
3. **Payment Links → + New** → choose the product.
   - Turn on **Let customers adjust quantity** (e.g. 1–10).
   - Under options, turn on **Collect customers' addresses → Shipping addresses** (choose allowed countries) and **add the shipping rate(s)** from step 2.
   - **After payment** → *Don't show confirmation page; redirect customers to your website* → `https://mjmacfadden.github.io/michael-james-guitars/success.html` (or your custom domain + `/success.html`).
4. Create the link, copy the URL (`https://buy.stripe.com/...`).
5. Paste it into that product's `"stripeLink"` in `data/products.json`, commit, push. The button changes from "Coming soon – email to order" to "Buy now".
Test first in Stripe **Test mode** with card `4242 4242 4242 4242`.

Note: each Payment Link is one product (quantity adjustable). A multi-product cart would need a small backend, so it's intentionally not included.

## Swap the logo
Replace `assets/logo.svg` with your logo (same filename). Using a PNG instead? Save it as `assets/logo.png` and change `assets/logo.svg` → `assets/logo.png` in the header of each `.html` file (one find/replace). Replace `assets/favicon.svg` too if you like.

## Enable GitHub Pages
Repo **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`** → Save. Site appears at `https://mjmacfadden.github.io/michael-james-guitars/` in a minute or two. Custom domain: add it on the same page.

## Preview locally
`python3 -m http.server 8000` then open http://localhost:8000 (a server is needed because products load via fetch).
