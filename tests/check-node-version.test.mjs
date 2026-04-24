import assert from 'node:assert/strict';
import {
  isSupportedNodeVersion,
  parseNodeVersion,
  SUPPORTED_NODE_VERSION_LABEL,
} from '../scripts/check-node-version.mjs';

assert.deepEqual(parseNodeVersion('22.12.3'), { major: 22, minor: 12, patch: 3 });

for (const version of ['20.19.0', '20.20.0', '22.12.0', '22.22.1', '23.0.0', '24.0.0', '25.0.0']) {
  assert.equal(isSupportedNodeVersion(version), true, `${version} should be supported`);
}

for (const version of ['18.20.0', '20.18.1', '21.7.3', '22.11.0', '26.0.0']) {
  assert.equal(isSupportedNodeVersion(version), false, `${version} should be unsupported`);
}

assert.match(SUPPORTED_NODE_VERSION_LABEL, /20\.19/);
assert.match(SUPPORTED_NODE_VERSION_LABEL, /25\.x/);
