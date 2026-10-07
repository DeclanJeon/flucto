#!/usr/bin/env node
// Predict the next release version from conventional commits since the latest
// stable v* git tag, relative to the version recorded in package.json.
//
//   predictRelease(cwd) -> { hasRelease: boolean, version: string }
//
// `hasRelease` is true only when conventional-recommended-bump (using the
// conventionalcommits preset) recommends major/minor/patch:
//   feat|feature            -> minor
//   fix|perf|revert         -> patch
//   BREAKING CHANGE / `!`   -> major
//   chore|docs|ci|style|test|build|refactor alone -> no release
//
// Read-only: only `git log`/tag reads and a package.json read; it never writes,
// commits, tags, or calls npm/GitHub, so no credentials are required.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Bumper } from 'conventional-recommended-bump';
import createConventionalCommitsPreset from 'conventional-changelog-conventionalcommits';

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const RELEASE_TYPES = new Set(['major', 'minor', 'patch']);

const readPackageVersion = async (cwd) => {
  const raw = await readFile(path.join(cwd, 'package.json'), 'utf8');
  const version = JSON.parse(raw)?.version;
  if (typeof version !== 'string' || !SEMVER_RE.test(version)) {
    throw new Error(`package.json has no valid semver version (got ${JSON.stringify(version)})`);
  }
  return version;
};

export const incrementVersion = (version, releaseType) => {
  const match = SEMVER_RE.exec(version);
  if (!match) throw new Error(`invalid semver version: ${version}`);
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  switch (releaseType) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`unsupported release type: ${releaseType}`);
  }
};

export const predictRelease = async (cwd = process.cwd()) => {
  const currentVersion = await readPackageVersion(cwd);
  const preset = createConventionalCommitsPreset();
  const bumper = new Bumper(cwd);
  bumper.config(preset);
  // Only stable v* release tags mark the release boundary; prerelease or
  // non-version tags do not reset the commit range.
  bumper.tag({ prefix: 'v', skipUnstable: true });
  // config() does not register whatBump on the bumper — pass it explicitly.
  const recommendation = await bumper.bump(preset.whatBump);
  const releaseType = recommendation?.releaseType;
  if (!RELEASE_TYPES.has(releaseType)) {
    return { hasRelease: false, version: '' };
  }
  return { hasRelease: true, version: incrementVersion(currentVersion, releaseType) };
};

export const main = async (argv, { log = console.log } = {}) => {
  const cwd = argv[0] ? path.resolve(argv[0]) : process.cwd();
  const result = await predictRelease(cwd);
  log(JSON.stringify(result));
  return result;
};

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedAsScript) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
