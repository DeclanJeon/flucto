import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { readFile, open, appendFile, unlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { EnrichmentError, observeInstagramPage, inputTargets, parseObservation, pageGate,
  profileFromObservation, authorFromObservation, isLinkHub, hubLinks, multipleLinksRef } from './instagram-profile-model.mjs';

const execute = promisify(execFile);
const terminal = new Set(['auth_or_challenge', 'rate_limited', 'identity_unconfirmed', 'followers_unavailable', 'error']);

export function optionsFromArgs(args) {
  const { values } = parseArgs({ args, options: {
    input: { type: 'string' }, output: { type: 'string' }, limit: { type: 'string', default: '10' },
    'interval-ms': { type: 'string', default: '3500' }, resume: { type: 'boolean', default: false },
  } });
  const limit = Number(values.limit);
  const interval = Number(values['interval-ms']);
  if (!values.input || !values.output || !Number.isInteger(limit) || limit < 1 || limit > 50
      || !Number.isInteger(interval) || interval < 3000 || interval > 60000) {
    throw new EnrichmentError('usage', '--input JSON --output JSONL [--limit 1..50] [--interval-ms 3000..60000] [--resume]');
  }
  return { input: values.input, output: values.output, limit, interval, resume: values.resume };
}

async function browser(args) {
  const { stdout } = await execute('agbrowse', args, { timeout: 45000, maxBuffer: 2 * 1024 * 1024 });
  return stdout;
}

// Only a fresh owned tab is navigated; a target change interrupts the batch.
async function assertOwned(targetId) {
  const active = JSON.parse(await browser(['active-tab', '--json']));
  if (active.targetId !== targetId) throw new EnrichmentError('target_changed', 'Browser active tab changed; stopping');
}

async function observe(url, context) {
  await assertOwned(context.targetId);
  await delay(Math.max(0, context.nextNavigationAt - Date.now()));
  await browser(['navigate', url]);
  context.nextNavigationAt = Date.now() + context.interval;
  await browser(['wait', '2500']);
  await assertOwned(context.targetId);
  await browser(['snapshot', '--interactive', '--max-nodes', '12']);
  return parseObservation(JSON.parse(await browser(['evaluate', `(${observeInstagramPage.toString()})()`])));
}

async function collect(target, context) {
  const first = await observe(target.url, context);
  const gate = pageGate(first);
  if (gate) return { status: gate, profileUrl: null, handle: target.handle, followerDisplay: null, links: [] };
  const profile = target.kind === 'post' ? authorFromObservation(first) : target;
  const observation = target.kind === 'post' ? await observe(profile.url, context) : first;
  const result = profileFromObservation(observation, profile);
  if (result.status !== 'observed') return result;
  const links = [...result.links];
  if (/외\s*\d+\s*개|and\s+\d+\s+others/i.test(observation.headerText)) {
    const snapshot = await browser(['snapshot', '--interactive', '--max-nodes', '90']);
    const ref = multipleLinksRef(snapshot);
    if (!ref) throw new EnrichmentError('links_unexpanded', 'Multiple profile links need a recognized expand button');
    await assertOwned(context.targetId);
    await browser(['click', ref]);
    await browser(['wait-for-selector', '[role="dialog"]', '--timeout', '8000']);
    await assertOwned(context.targetId);
    await browser(['snapshot', '--interactive', '--max-nodes', '30']);
    const popup = parseObservation(JSON.parse(await browser(['evaluate', `(${observeInstagramPage.toString()})()`])));
    links.push(...hubLinks(popup).map(link => ({ ...link, kind: isLinkHub(link.url) ? 'hub' : link.kind })));
    if (!links.length) throw new EnrichmentError('links_unexpanded', 'Expanded profile links were unavailable');
  }
  const hubs = [...new Map(links.filter(link => isLinkHub(link.url)).map(link => [link.url, link])).values()];
  for (const link of hubs.slice(0, 2)) {
    const hub = await observe(link.url, context);
    const hubGate = pageGate(hub);
    if (hubGate) return { ...result, status: hubGate, links };
    // Only allowlisted hub pages are examined. Never follow arbitrary commerce links.
    if (!isLinkHub(hub.url)) throw new EnrichmentError('hub_redirect', 'Link hub redirected outside the permitted hub hosts');
    links.push(...hubLinks(hub));
  }
  return { ...result, links };
}

export async function main(args) {
  const options = optionsFromArgs(args);
  const targets = inputTargets(JSON.parse(await readFile(options.input, 'utf8')));
  const lockPath = `${options.output}.lock`;
  const lock = await open(lockPath, 'wx');
  let targetId;
  try {
    const completed = new Set();
    if (options.resume) {
      const previous = (await readFile(options.output, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
      for (const row of previous) {
        if (row.schema !== 'instagram-enrichment-v1' || typeof row.inputUrl !== 'string') {
          throw new EnrichmentError('checkpoint', 'Unexpected checkpoint schema');
        }
        if (row.status === 'observed') completed.add(row.inputUrl);
      }
    } else {
      const output = await open(options.output, 'wx');
      await output.close();
    }
    const pending = targets.filter(target => !completed.has(target.url)).slice(0, options.limit);
    if (!pending.length) return { processed: 0, stopped: false };
    const tab = JSON.parse(await browser(['new-tab', 'about:blank', '--json']));
    if (typeof tab.targetId !== 'string') throw new EnrichmentError('protocol', 'New tab returned no target id');
    targetId = tab.targetId;
    const context = { targetId, interval: options.interval, nextNavigationAt: 0 };
    let processed = 0;
    for (const target of pending) {
      let result;
      try {
        result = await collect(target, context);
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        // Boundary catch: persist failure and halt, never mark it as an empty profile.
        result = { status: 'error', profileUrl: null, handle: target.handle, followerDisplay: null, links: [],
          errorCode: error instanceof EnrichmentError ? error.code : 'browser_error', error: error.message.slice(0, 350) };
      }
      const row = { schema: 'instagram-enrichment-v1', inputUrl: target.url, observedAt: new Date().toISOString(), ...result };
      await appendFile(options.output, `${JSON.stringify(row)}\n`);
      processed += 1;
      console.error(JSON.stringify({ handle: row.handle, status: row.status, processed }));
      if (terminal.has(row.status)) return { processed, stopped: true, reason: row.status };
    }
    return { processed, stopped: false };
  } finally {
    try {
      if (targetId) await browser(['tab-close', targetId, '--json']);
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await main(process.argv.slice(2));
    console.log(JSON.stringify(result));
    if (result.stopped) process.exitCode = 3;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(JSON.stringify({ error: error.message, code: error instanceof EnrichmentError ? error.code : 'runtime' }));
    process.exitCode = 2;
  }
}
