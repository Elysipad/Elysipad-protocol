import fs from 'node:fs';
import path from 'node:path';
import { readImage, pixelHex } from './image.mjs';

// Parses "/* @sample file x y */ --name: #hex;" pairs out of tokens.css.
export function parseTokens(file) {
  const css = fs.readFileSync(file, 'utf8');
  const re = /\/\*\s*@sample\s+(.+?)\s+(\d+)\s+(\d+)\s*\*\/\s*(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
  const out = []; let m;
  while ((m = re.exec(css))) out.push({ file: m[1], x: +m[2], y: +m[3], name: m[4], hex: m[5].toLowerCase() });
  return out;
}

export function tokenMap(file) {
  return Object.fromEntries(parseTokens(file).map((t) => [t.name, t.hex]));
}

export function verifySamples(root, tokens) {
  const cache = new Map(); const bad = [];
  for (const t of tokens) {
    if (!cache.has(t.file)) cache.set(t.file, readImage(path.join(root, t.file)));
    const got = pixelHex(cache.get(t.file), t.x, t.y);
    if (got !== t.hex) bad.push(`${t.name} says ${t.hex}, pixel (${t.x},${t.y}) of ${t.file} is ${got}`);
  }
  return bad;
}
