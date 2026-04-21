#!/usr/bin/env node
import { copyFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptDir, '..');

const assets = [
  ['src/db/schema.sql', 'dist/db/schema.sql'],
];

for (const [srcRel, destRel] of assets) {
  const src = path.join(backendRoot, srcRel);
  const dest = path.join(backendRoot, destRel);
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}
