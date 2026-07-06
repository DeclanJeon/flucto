import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cleanTranscriptText,
  formatTranscriptMarkdown,
  formatTranscriptTime,
  sanitizeMarkdownFilename,
} from '../dist-electron/main/transcript/markdownFormatter.js';
import {
  listCaptionLanguagesFromInfo,
  parseJson3Captions,
  parseVttCaptions,
  parseXmlCaptions,
  resolveCaptionLanguage,
} from '../dist-electron/main/transcript/captionExtractor.js';
import {
  TranscriptError,
  toTranscriptError,
} from '../dist-electron/main/transcript/transcriptError.js';

const metadata = {
  id: 'video-1',
  title: 'Transcript Test Video',
  channel: 'Flucto QA',
  duration: '1:02:03',
  url: 'https://example.test/watch?v=video-1',
  platform: 'youtube',
  language: 'en',
};

test('formatter returns no markdown for an empty transcript when metadata is excluded', () => {
  assert.equal(
    formatTranscriptMarkdown([], metadata, {
      includeTimestamps: true,
      includeMetadata: false,
      paragraphGapSeconds: 5,
    }),
    '',
  );
});

test('formatter groups adjacent captions into timestamped paragraphs and splits on the configured gap', () => {
  const markdown = formatTranscriptMarkdown(
    [
      { text: 'First line', start: 0, duration: 2 },
      { text: 'continues here', start: 3, duration: 1 },
      { text: 'New paragraph', start: 10, duration: 2 },
    ],
    metadata,
    { includeTimestamps: true, includeMetadata: false, paragraphGapSeconds: 5 },
  );

  assert.equal(markdown, '## [00:00]\n\nFirst line continues here\n\n## [00:10]\n\nNew paragraph\n');
});

test('formatter emits hour timestamps for long transcripts', () => {
  assert.equal(formatTranscriptTime(3661.9), '1:01:01');

  const markdown = formatTranscriptMarkdown(
    [{ text: 'Past the first hour', start: 3661.9, duration: 4 }],
    metadata,
    { includeTimestamps: true, includeMetadata: false, paragraphGapSeconds: 5 },
  );

  assert.match(markdown, /^## \[1:01:01\]/);
});

test('formatter includes metadata only when requested', () => {
  const withMetadata = formatTranscriptMarkdown(
    [{ text: 'Caption text', start: 0, duration: 1 }],
    metadata,
    { includeTimestamps: false, includeMetadata: true, paragraphGapSeconds: 5 },
  );
  assert.match(withMetadata, /^# Transcript Test Video\n/);
  assert.match(withMetadata, /> \*\*채널:\*\* Flucto QA  /);
  assert.match(withMetadata, /> \*\*URL:\*\* \[https:\/\/example\.test\/watch\?v=video-1\]\(https:\/\/example\.test\/watch\?v=video-1\)  /);
  assert.match(withMetadata, /\n---\n\nCaption text\n$/);

  const withoutMetadata = formatTranscriptMarkdown(
    [{ text: 'Caption text', start: 0, duration: 1 }],
    metadata,
    { includeTimestamps: false, includeMetadata: false, paragraphGapSeconds: 5 },
  );
  assert.equal(withoutMetadata, 'Caption text\n');
});

test('formatter cleans caption HTML, named entities, numeric entities, and excess whitespace', () => {
  assert.equal(
    cleanTranscriptText('  <b>Hello</b>&nbsp;&amp; &#x1F44B; &#65;   world\n\n\nnext  '),
    'Hello & 👋 A world\n\nnext',
  );

  const markdown = formatTranscriptMarkdown(
    [{ text: '<i>Keep</i>&nbsp;this   tidy', start: 0, duration: 1 }],
    metadata,
    { includeTimestamps: false, includeMetadata: false, paragraphGapSeconds: 5 },
  );
  assert.equal(markdown, 'Keep this tidy\n');
});

test('sanitizer produces dated filesystem-safe markdown filenames with reserved names escaped', () => {
  const date = new Date(2026, 6, 6);

  assert.equal(
    sanitizeMarkdownFilename('Bad <Title>: / test? * name', date),
    'Bad_Title_test_name_20260706.md',
  );
  assert.equal(sanitizeMarkdownFilename('CON', date), 'CON_file_20260706.md');
  assert.equal(sanitizeMarkdownFilename('<>:/\\|?*', date), 'transcript_20260706.md');
});

test('JSON3 parser concatenates text segments, converts millisecond timing, and skips empty events', () => {
  const segments = parseJson3Captions(JSON.stringify({
    events: [
      { tStartMs: 1500, dDurationMs: 2500, segs: [{ utf8: 'Hello' }, { utf8: ' world' }] },
      { tStartMs: 4000, dDurationMs: 1000, segs: [{ utf8: '   ' }] },
      { tStartMs: 5000, segs: [{ utf8: 'No duration' }] },
    ],
  }));

  assert.deepEqual(segments, [
    { text: 'Hello world', start: 1.5, duration: 2.5 },
    { text: 'No duration', start: 5, duration: 0 },
  ]);
});

test('XML/SRV3 parser extracts timed text, accepts duration aliases, strips nested tags, and skips empty text nodes', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<transcript>
  <text start="1.25" dur="2.5">Hello <font color="#fff">world</font></text>
  <text start="4" duration="1.75"><b>Second</b> cue</text>
  <text start="9" dur="1"><i></i></text>
</transcript>`;

  assert.deepEqual(parseXmlCaptions(xml), [
    { text: 'Hello world', start: 1.25, duration: 2.5 },
    { text: 'Second cue', start: 4, duration: 1.75 },
  ]);
});

test('SRV3 parser converts millisecond p t/d attributes to second-based segments', () => {
  const srv3 = `<?xml version="1.0" encoding="utf-8"?>
<timedtext format="3">
  <body>
    <p t="1250" d="2750"><s>Hello</s><s> world</s></p>
    <p t="6000" d="500"><s>Next cue</s></p>
    <p t="8000" d="250"><s>   </s></p>
  </body>
</timedtext>`;

  assert.deepEqual(parseXmlCaptions(srv3), [
    { text: 'Hello world', start: 1.25, duration: 2.75 },
    { text: 'Next cue', start: 6, duration: 0.5 },
  ]);
});

test('VTT parser handles cue identifiers, note blocks, settings, comma timestamps, and hour timestamps', () => {
  const vtt = `WEBVTT

NOTE this block must not become a caption

cue-1
00:00:01,500 --> 00:00:03.000 align:start
<v Speaker>Hello</v> there

01:02:03.250 --> 01:02:05.000
Long running cue`;

  assert.deepEqual(parseVttCaptions(vtt), [
    { text: 'Hello there', start: 1.5, duration: 1.5 },
    { text: 'Long running cue', start: 3723.25, duration: 1.75 },
  ]);
});

test('caption language list prefers manual captions over duplicate automatic captions and sorts by code', () => {
  const info = {
    subtitles: {
      ko: [{ name: 'Korean' }],
      en: [{ name: 'English' }],
    },
    automatic_captions: {
      en: [{ name: 'English auto' }],
      ja: [{}],
    },
  };

  assert.deepEqual(listCaptionLanguagesFromInfo(info), [
    { code: 'en', name: 'English', isAuto: false },
    { code: 'ja', name: 'ja', isAuto: true },
    { code: 'ko', name: 'Korean', isAuto: false },
  ]);
});

test('caption language resolver honors exact requests, base-language fallback, manual default, automatic fallback, and no-caption cases', () => {
  const mixedInfo = {
    subtitles: {
      en: [{ name: 'English' }],
      ko: [{ name: 'Korean' }],
    },
    automatic_captions: {
      fr: [{ name: 'French auto' }],
    },
  };

  assert.equal(resolveCaptionLanguage(mixedInfo, 'ko'), 'ko');
  assert.equal(resolveCaptionLanguage(mixedInfo, 'en-US'), 'en');
  assert.equal(resolveCaptionLanguage(mixedInfo, 'fr-CA'), 'fr');
  assert.equal(resolveCaptionLanguage(mixedInfo, 'de'), 'en');
  assert.equal(resolveCaptionLanguage({ automatic_captions: { ja: [{}] } }, null), 'ja');
  assert.equal(resolveCaptionLanguage(mixedInfo, 'auto'), 'en');
  assert.equal(resolveCaptionLanguage({}, 'en'), null);
});

test('no-caption language resolution stays unavailable instead of becoming an upstream error', () => {
  assert.equal(resolveCaptionLanguage({}, null), null);
  assert.equal(resolveCaptionLanguage({ subtitles: { en: [] }, automatic_captions: { ko: [] } }, 'en'), null);
  assert.deepEqual(listCaptionLanguagesFromInfo({ subtitles: { en: [] }, automatic_captions: { ko: [] } }), []);

  const unavailable = new TranscriptError('TRANSCRIPT_UNAVAILABLE', 'No captions are available for this media.');
  assert.equal(toTranscriptError(unavailable), unavailable);
  assert.equal(toTranscriptError(unavailable).code, 'TRANSCRIPT_UNAVAILABLE');
});
