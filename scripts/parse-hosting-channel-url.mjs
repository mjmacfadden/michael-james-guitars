#!/usr/bin/env node
import fs from "fs";

const raw = fs.readFileSync(process.argv[2] || "deploy.json", "utf8").trim();

function parseMaybe(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

let j = parseMaybe(raw);
if (!j) {
  const matches = [...raw.matchAll(/\{[\s\S]*\}/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    j = parseMaybe(matches[i][0]);
    if (j) break;
  }
}

function findUrl(o, depth = 0) {
  if (!o || typeof o !== "object" || depth > 6) return "";
  if (typeof o.url === "string" && /^https?:\/\//.test(o.url)) return o.url;
  for (const v of Object.values(o)) {
    const u = findUrl(v, depth + 1);
    if (u) return u;
  }
  return "";
}

const u = findUrl(j);
if (!u) {
  console.error("Could not parse preview URL from:", raw.slice(0, 2000));
  process.exit(1);
}
process.stdout.write(u);
