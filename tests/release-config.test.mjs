import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const releaseWorkflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const releaseConfig = JSON.parse(fs.readFileSync(new URL('../.releaserc.json', import.meta.url), 'utf8'));

const githubPlugin = releaseConfig.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === '@semantic-release/github',
);
const publishedAssetPaths = githubPlugin?.[1]?.assets?.map((asset) => asset.path) ?? [];

test('release workflow preserves electron-updater metadata', () => {
  assert.match(releaseWorkflow, /^\s+release\/latest\*\.yml$/m);
  assert.match(releaseWorkflow, /^\s+release\/\*\.blockmap$/m);
});

test('GitHub releases publish platform update manifests and blockmaps', () => {
  assert.ok(githubPlugin, 'missing @semantic-release/github configuration');
  assert.deepEqual(
    publishedAssetPaths.filter((assetPath) => assetPath.includes('latest')).sort(),
    ['release/latest-linux.yml', 'release/latest-mac.yml', 'release/latest.yml'],
  );
  assert.ok(publishedAssetPaths.includes('release/*.blockmap'));
});
