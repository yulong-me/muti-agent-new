#!/usr/bin/env node

const REQUIRED_MAJOR = 22;
const currentVersion = process.versions.node;
const currentMajor = Number.parseInt(currentVersion.split('.')[0] ?? '0', 10);

if (currentMajor !== REQUIRED_MAJOR) {
  console.error(
    [
      `Unsupported Node.js version: ${currentVersion}`,
      `This repo is pinned to Node.js ${REQUIRED_MAJOR}.x to avoid native-module ABI drift and toolchain incompatibilities.`,
      'Use the version from `.nvmrc` / `.node-version`, then reinstall dependencies if you changed Node major versions.',
    ].join('\n'),
  );
  process.exit(1);
}
