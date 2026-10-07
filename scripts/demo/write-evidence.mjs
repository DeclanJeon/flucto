// Writes assets/demo/features/<id>.json provenance evidence for CLI clips 08–12.
// Merges: capture-transcript facts (commands, exits, real outputs, hashes) +
// final asset probes. Matches the desktop clips' JSON shape.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const CAP = join(HERE, 'captures');
const OUT = join(REPO, 'assets', 'demo', 'features');

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const probe = (p) => JSON.parse(execFileSync('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,width,height,nb_frames',
  '-of', 'json', p], { encoding: 'utf8' }));

const CAPTURE_NOTE =
  'Deterministic replay of stdout/stderr captured from the real Flucto CLI (cmd /c, FORCE_COLOR=1), ' +
  'rendered in a terminal-styled viewer labeled "actual CLI output". No synthetic or typed output; ' +
  'every command was executed live by capture-transcript.mjs and exits are recorded in the transcript JSON.';

const CLIPS = {
  '08-cli-inspect': {
    timing: 'Native pacing from the real command timestamps; waits left intact.',
    rights: 'Localhost fixture (self-authored ffmpeg lavfi MP4 + hand-written WebVTT) served by scripts/demo/serve-fixture.mjs; Big Buck Bunny (Blender Foundation, CC-BY) used for `formats`/`search` metadata display only — nothing downloaded.',
    commands: [
      'flucto info "http://127.0.0.1:58080/reference-a.html" -j',
      'flucto search "blender tutorial" --platform youtube --limit 5',
      'flucto languages "http://127.0.0.1:58080/reference-a.html"',
      'flucto formats "https://www.youtube.com/watch?v=YE7VzlLtp-4"',
    ],
    results: [
      'info JSON: id "reference-a-1", self-authored localhost title, thumbnail, exit 0',
      'search: 5 real YouTube native results + "YouTube (native): 5 results" line, exit 0',
      'languages: en + ko tracks of the localhost fixture, exit 0',
      'formats: real yt-dlp format table for Big Buck Bunny (video+audio variants), exit 0',
    ],
  },
  '09-cli-batch-json': {
    timing: 'Native pacing from real download/batch timestamps.',
    rights: 'All sources are the self-authored localhost fixture MP4s; output files verified as real mp4/mp3 by ffprobe.',
    commands: [
      'type urls.txt',
      'flucto download "http://127.0.0.1:58080/reference-b.html" -f mp4 -o out -j',
      'flucto batch urls.txt -f mp3 -c 2 -o out -p -j',
      'dir /b /s out',
    ],
    results: [
      'download: real MP4 to C:\\flucto-demo\\out (ffprobe h264+aac, 12s), exit 0',
      'batch: NDJSON progress events on stderr + final JSON summary {"success":true,"total":2,"failed":0}, dedicated out\\urls-batch-mp3-* folder, exit 0',
      'two real .mp3 audio extractions (ffprobe mp3 codec, 12s each)',
    ],
  },
  '10-cli-media-markdown': {
    timing: 'Native pacing; transcript fetch + markdown conversion in real time.',
    rights: 'Self-authored localhost fixture; English and Korean WebVTT tracks written by hand for this demo.',
    commands: [
      'flucto md "http://127.0.0.1:58080/reference-a.html" -l ko --stdout',
      'flucto md "http://127.0.0.1:58080/reference-a.html" -l en -o notes',
      'dir /b notes',
    ],
    results: [
      'Korean Markdown streamed to stdout from the real ko.vtt track (front-matter + timestamped sections), exit 0',
      'English Markdown saved to notes\\Reference_Clip_A_—_Flucto_Demo_Fixture_(self-autho_20261007.md, exit 0',
    ],
  },
  '11-cli-channel-archive': {
    timing: 'Native pacing; real channel listing + two caption extractions (~27s).',
    rights: 'Blender Foundation YouTube channel @BlenderOfficial — public videos with captions; only caption text converted to Markdown (no video downloaded). Localhost feed cannot produce channel listing because yt-dlp generic extractor emits no per-item ids for RSS/HTML link lists — recorded limitation, real channel used instead.',
    commands: [
      'flucto channel to-md "@BlenderOfficial" --limit 2 -o notes',
      'dir /b /o-d notes',
    ],
    results: [
      'channel "Blender" resolved; dedicated folder C:\\flucto-demo\\notes\\Blender-channel-md-20261007-221703',
      '001_The_Future_of_Rendering_—_BCON26_20261007.md + 002_Subject_Extraction_for_Scene_Reconstruction_in_VFX_20261007.md in listing order; 2/2 succeeded, exit 0',
    ],
  },
  '12-cli-setup-update': {
    timing: 'Dwell-time compression only: 0–4.8s at 2x, the Node download/install segment (4.8–96s of source) at 12x, 96–122s at 1.5x; on-video badge "time-compressed (up to 12x)". Frames stay chronological, nothing cut.',
    rights: 'Official public release asset Flucto-1.18.0-cli-setup.zip from github.com/DeclanJeon/flucto/releases; sha256 verified (742d0f99…420ee). Install prefix C:\\flucto-cli is a private disposable prefix; -NoProfile leaves user PATH/profile untouched.',
    commands: [
      'flucto --version',
      'powershell -NoProfile -Command "Get-FileHash Flucto-1.18.0-cli-setup.zip -Algorithm SHA256 | Format-List Hash"',
      'mkdir pkg & tar -xf Flucto-1.18.0-cli-setup.zip -C pkg & dir /b pkg',
      'powershell -NoProfile -ExecutionPolicy Bypass -File pkg\\install.ps1 -InstallDir C:\\flucto-cli -NoProfile',
      'flucto doctor',
      'flucto update check',
      'flucto update apply',
      'flucto --version',
    ],
    results: [
      'ZIP sha256 verified against release checksums-sha256.txt',
      'install.ps1: Node v24.21.0 private runtime, npm tarball install, yt-dlp 2026.09.27.232945 + ffmpeg 8.1.2 into C:\\flucto-cli\\bin, doctor {"valid":true}',
      'update check: "Flucto is up to date (1.18.0)"; update apply: npm reinstall into same private prefix, "Update applied in place"',
      'all exits 0; version banner 1.18.0 before and after',
    ],
  },
};

for (const [id, clip] of Object.entries(CLIPS)) {
  const tPath = join(CAP, `${id}.transcript.json`);
  const t = existsSync(tPath) ? JSON.parse(readFileSync(tPath, 'utf8')) : null;
  const mp4 = join(OUT, `${id}.mp4`);
  const gif = join(OUT, `${id}.gif`);
  const png = join(OUT, `${id}.png`);
  if (!existsSync(mp4) || !existsSync(gif) || !existsSync(png)) { console.error(`${id}: missing asset`); continue; }
  const mp4p = probe(mp4);
  const ev = {
    id,
    productVersion: '1.18.0',
    capture: CAPTURE_NOTE,
    timing: clip.timing,
    sourceRights: clip.rights,
    commands: clip.commands,
    observedResults: clip.results,
    durationSeconds: Number(mp4p.format.duration),
    transcriptEvents: t ? t.events.length : null,
    transcriptWallMs: t ? t.wallMs : null,
    transcriptExitCode: t ? t.exitCode : null,
    transcriptSha256: t ? sha256(tPath) : null,
    assets: {
      mp4: { bytes: statSync(mp4).size, sha256: sha256(mp4), width: mp4p.streams[0].width, height: mp4p.streams[0].height },
      gif: { bytes: statSync(gif).size, sha256: sha256(gif), frames: Number(probe(gif).streams[0].nb_frames) },
      png: { bytes: statSync(png).size, sha256: sha256(png) },
    },
    sources: [{
      part: `${id}-complete`,
      source: clip.commands[0],
      commands: clip.commands,
      transcript: `scripts/demo/captures/${id}.transcript.json`,
      transcriptLog: `scripts/demo/captures/${id}.transcript.log`,
    }],
  };
  writeFileSync(join(OUT, `${id}.json`), JSON.stringify(ev, null, 2));
  console.log(`${id}.json written (${ev.durationSeconds}s, ${ev.assets.gif.frames} gif frames)`);
}
