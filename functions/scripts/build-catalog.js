#!/usr/bin/env node
/**
 * Generate ../data/checkout-catalog.json (public storefront data) from functions/data/catalog.json.
 *   node scripts/build-catalog.js          # write
 *   node scripts/build-catalog.js --check  # exit 1 if the committed file has drifted
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, publicCatalogJson } from '../src/catalog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.env.CATALOG_SOURCE || path.resolve(here, '../data/catalog.json');
const out = process.env.CATALOG_PUBLIC_OUT || path.resolve(here, '../../data/checkout-catalog.json');
const expected = publicCatalogJson(loadCatalog(src));

if (process.argv.includes('--check')) {
  const actual = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (actual !== expected) {
    console.error(`DRIFT: ${path.relative(process.cwd(), out)} does not match the catalog. Run: npm run catalog:build`);
    process.exit(1);
  }
  console.log('catalog check: public checkout-catalog.json is up to date');
} else {
  fs.writeFileSync(out, expected);
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
}
