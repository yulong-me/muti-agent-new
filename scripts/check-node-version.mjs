#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const currentVersion = process.versions.node;
export const SUPPORTED_NODE_VERSION_LABEL = '20.19.x, 22.12.x or newer 22.x, 23.x, 24.x, and 25.x';

export function parseNodeVersion(version) {
  const [major = '0', minor = '0', patch = '0'] = version.split('.');
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
  };
}

export function atLeastNodeVersion(version, major, minor, patch) {
  if (version.major !== major) return false;
  if (version.minor !== minor) return version.minor > minor;
  return version.patch >= patch;
}

export function isSupportedParsedNodeVersion(version) {
  if (version.major === 20) {
    return atLeastNodeVersion(version, 20, 19, 0);
  }

  if (version.major >= 22 && version.major < 26) {
    if (version.major === 22) {
      return atLeastNodeVersion(version, 22, 12, 0);
    }
    return true;
  }

  return false;
}

export function isSupportedNodeVersion(version) {
  return isSupportedParsedNodeVersion(parseNodeVersion(version));
}

function checkCurrentNodeVersion() {
  if (isSupportedNodeVersion(currentVersion)) return;

  console.error(
    [
      `Unsupported Node.js version: ${currentVersion}`,
      `Supported Node.js versions: ${SUPPORTED_NODE_VERSION_LABEL}.`,
      'These bounds match the current Next.js, Vitest, and better-sqlite3 toolchain.',
      'Use the pinned version from `.nvmrc` / `.node-version` when you want the default local runtime.',
      'Reinstall dependencies if you changed Node major versions.',
    ].join('\n'),
  );
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkCurrentNodeVersion();
}
