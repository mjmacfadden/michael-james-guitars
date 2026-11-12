# Fretboard Builder (store page)

The 3D-printable cigar box guitar fretboard generator, running as a native page of the store:
**`fretboard-builder.html`** (also reachable at `/fretboard-builder`, which redirects there).
It's fully client-side: geometry, 3D preview and STL download all run in the visitor's browser.
No Functions, Firestore or Stripe involved.

## What lives where

| Path | What it is | Edit it here? |
| --- | --- | --- |
| `../fretboard-builder.html` | The store page: store header/nav/cart/footer + the builder controls | **Yes** |
| `builder.css` | Builder styling using the store's colors, fonts and button look | **Yes** |
| `design-config.js` | Versioned, shareable design config (`#design=` links) + the disabled "Order this" hook | **Yes** |
| `store-page.js` | Share button, keeps the URL as a live share link, order-button gate | **Yes** |
| `ORDERING.md` | Plan for letting customers order the boards they design | **Yes** |
| `engine/` | `geometry.js`, `stl.js`, `app.js`, `test.js`, `vendor/earcut` copied **verbatim** from upstream | **No, edit upstream** |
| `UPSTREAM.json` | Which upstream commit `engine/` came from, plus a checksum per file | Generated |

## Source of truth

**The geometry engine's source of truth stays the standalone repo
[`mjmacfadden/fretboard-builder`](https://github.com/mjmacfadden/fretboard-builder)** (its GitHub Pages site keeps working
as-is). **The store page, its styling, the design-config and ordering pieces live only here.**

Why this split:
- The geometry is the hard, well-tested part (`node test.js` checks watertight meshes, fret math, seams, the
  fillet and more). Keeping one copy of it, unchanged, means the store page and the standalone site always build
  the same STL for the same settings, and the existing Meta Muse prompt → `fretboard-builder` repo workflow keeps working.
- Everything store-specific (look and feel, cart, future ordering) changes for store reasons, so it belongs
  in the store repo and never has to be pushed back upstream.
- `engine/app.js` is used unchanged: the store page reuses the same element ids, and `design-config.js` /
  `store-page.js` sit around it instead of patching it.

Guard rails (all run by `npm --prefix functions test`, which CI runs on every PR):
- `engine/` must match `UPSTREAM.json` byte-for-byte, so a stray edit here fails CI.
- The upstream geometry suite (`engine/test.js`) must print `ALL GEOMETRY TESTS PASSED`.
- Every element id `engine/app.js` reads must exist on the store page, and the page's control defaults must
  match the design-config defaults.
- `design-config.js` must turn a design into exactly the build params `app.js` would (checked by running
  `app.js` against a fake page), so a server can later rebuild the same STL from a saved design.

If you'd rather make the store the only home later, copy the standalone page's last tweaks across, stop syncing,
and archive the old repo. Nothing here depends on it at runtime.

## Updating the engine (after a change lands in fretboard-builder)

1. Commit the change in `~/Documents/GitHub/fretboard-builder` (the sync refuses uncommitted engine changes).
2. From this repo's folder in Terminal:
   ```
   node scripts/sync-fretboard-builder.mjs ../fretboard-builder
   node fretboard-builder/engine/test.js
   npm --prefix functions test
   ```
3. If a test says an element id is missing, a control was added or renamed upstream: copy that control's
   markup from the standalone `index.html` into `fretboard-builder.html`, and add a field for it to
   `FIELDS` in `design-config.js` (a new field with a default is backward compatible; see the notes at the
   top of that file).
4. Commit on a branch in GitHub Desktop, push, open a PR and check the preview link.

## Design config and share links

Every option on the page is captured as a small versioned JSON document:

```json
{ "schema": "mjg.fretboard-design", "version": 1, "engine": "fretboard-builder@fe04491",
  "params": { "strings": 4, "frets": 19, "fretMode": "chromatic", "scaleIn": 23.5, "...": "..." } }
```

- The address bar always carries the current design as `fretboard-builder.html#design=<base64url JSON>`; the
  **Copy link to this design** button copies it. Opening such a link loads that design. The `#` part never
  reaches a server.
- Bad or out-of-range values in a link are reset or clamped (the page says so).
- `FretboardDesign.toBuildParams(params, Fretboard)` turns a design into `Fretboard.buildFretboard()` params,
  so the exact STL can be regenerated anywhere (browser or Node).

## Run it locally

From the repo folder: `python3 -m http.server 8000`, then open
http://localhost:8000/fretboard-builder.html (the store's cart needs a server; the builder itself would run from a file).
