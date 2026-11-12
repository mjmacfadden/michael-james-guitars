# Michael James Guitars — storefront

Static site (plain HTML/CSS/JS, no build step) for selling handmade piezo bridge pickups for cigar box guitars. Live site on **Firebase Hosting** (`https://michael-james-guitars.web.app`); checkout via **Stripe Payment Links** in test/legacy mode until backend cutover.

## Files
- `data/products.json` — **single source of truth** for products, prices, Stripe links, and the contact email.
- `assets/img/michael_james_logo.png` — header logo. `assets/favicon.svg` — favicon.
- `assets/img/products/` — product photos.
- `index.html`, `shop.html`, `product.html?id=...`, `about.html`, `faq.html`, `contact.html`, `success.html`, `cancel.html`, `404.html`.
- `fretboard-builder.html` + `fretboard-builder/` — the **Fretboard Builder** page (3D-printable cigar box guitar fretboards, all in the browser). The geometry engine in `fretboard-builder/engine/` is synced from the [`fretboard-builder`](https://github.com/mjmacfadden/fretboard-builder) repo; see `fretboard-builder/README.md` (and `ORDERING.md` for future custom orders).
- Search the repo for `TODO` to find everything still to fill in.

## Edit products
Each entry in `data/products.json`:
```json
{ "id": "url-safe-id", "name": "...", "price": 15, "shortDescription": "...", "description": "...",
  "specs": { "Strings": "3" }, "installNotes": "...", "images": ["assets/img/products/x"], "imageAlts": ["..."],
  "video": { "src": "assets/video/x.mp4", "poster": "assets/video/x.jpg", "caption": "..." },
  "stripeLink": "", "inStock": true }
```
Prices display as "$15 + shipping". Set `inStock: false` to show "Sold out". Also set `contactEmail` at the top.

### Photos
Each entry in `images` is a **base path without extension**; the site expects four files per photo: `<base>.jpg` and `<base>.webp` (1600px long side) plus `<base>-800.jpg` and `<base>-800.webp`. The first photo is the card/main image. Don't commit original phone photos/videos (large, and contain GPS EXIF). Example with ImageMagick (auto-orients and strips metadata):
```
convert IMG.jpeg -auto-orient -strip -resize 1600x1600 -quality 80 assets/img/products/name.jpg
convert IMG.jpeg -auto-orient -strip -resize 1600x1600 -quality 78 assets/img/products/name.webp
convert IMG.jpeg -auto-orient -strip -resize 800x800  -quality 80 assets/img/products/name-800.jpg
convert IMG.jpeg -auto-orient -strip -resize 800x800  -quality 78 assets/img/products/name-800.webp
```
Video: `ffmpeg -i IN.mov -an -vf scale=540:-2 -c:v libx264 -crf 28 -pix_fmt yuv420p -movflags +faststart -map_metadata -1 assets/video/name.mp4`. The home hero background and `assets/img/og-image.jpg` (1200x630 social preview) use the installed-bridge photo.

## Add Stripe Payment Links (step by step)
1. Stripe Dashboard → **Product catalog → + Add product**. Name it, set a one-time price of **$15.00 USD**. Repeat per product.
2. Set up shipping: **Settings → Shipping rates** (or create one inside the Payment Link) → add a rate, e.g. flat "USPS First Class – $5.00", or several tiers (Standard / Priority) so customers pick one.
3. **Payment Links → + New** → choose the product.
   - Turn on **Let customers adjust quantity** (e.g. 1–10).
   - Under options, turn on **Collect customers' addresses → Shipping addresses** (choose allowed countries) and **add the shipping rate(s)** from step 2.
   - **After payment** → *Don't show confirmation page; redirect customers to your website* → `https://michael-james-guitars.web.app/success.html` (or your custom domain + `/success.html`).
4. Create the link, copy the URL (`https://buy.stripe.com/...`).
5. Paste it into that product's `"stripeLink"` in `data/products.json`, commit, push. The button changes from "Coming soon – email to order" to "Buy now".
Test first in Stripe **Test mode** with card `4242 4242 4242 4242`.

Note: each Payment Link is one product (quantity adjustable). A multi-product cart would need a small backend, so it's intentionally not included.

## Swap the logo
The header uses `assets/img/michael_james_logo.png`. Replace that file (keep the same name) to update every page. Change `assets/favicon.svg` too if you like.

## Deploy (Firebase Hosting via GitHub Actions)

Live site: **https://michael-james-guitars.web.app**

| Event | What runs | Result |
| --- | --- | --- |
| Open / update a PR (same repo) | `firebase-hosting-preview.yml` | Temporary preview URL + tests |
| Merge / push to `main` | `firebase-hosting-live.yml` | Publishes **Hosting only** to live |
| Functions / Firestore / secrets | *not* auto-deployed | Deploy those manually after review |

Auth is short-lived OIDC → Workload Identity Federation (no JSON service-account keys in the repo).

### Day-to-day workflow
1. Pull latest `main` into your local clone (keep any uncommitted Mac edits; stash or commit them on a side branch first if git complains — do **not** `reset --hard`).
2. Create / switch to a feature branch; edit storefront or config; commit; push the branch.
3. Open a PR into `main`. Actions runs tests and deploys a **preview** channel — use that URL to review.
4. When the preview looks right and checks are green, **merge** the PR. That push to `main` auto-publishes Hosting to live.
5. Watch progress under the repo **Actions** tab (`Firebase Hosting live`). Confirm https://michael-james-guitars.web.app.
6. Cloud Functions / backend / Stripe live mode are **not** published by this flow — treat those as separate, explicit steps.

### Preview locally
`python3 -m http.server 8000` then open http://localhost:8000 (a server is needed because products load via fetch). For the staged Hosting mirror: `node scripts/stage-public.mjs` then serve `public/`.
