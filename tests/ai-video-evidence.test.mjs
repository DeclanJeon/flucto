import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyAiVideoEvidence } from '../dist-electron/main/services/aiVideoEvidence.js';

const evidence = (text, source = 'creator_description', url = 'https://example.com/video') => ({ source, text, url });

test('explicit creator disclosure confirms generated media and preserves provenance', () => {
  const result = classifyAiVideoEvidence({
    disclosures: [evidence('The visuals in this video were generated entirely with AI.')],
    metadataAvailable: true,
  });

  assert.equal(result.aiMediaStatus, 'confirmed');
  assert.equal(result.aiAssistedStatus, 'not_indicated');
  assert.ok(result.reasonCodes.includes('creator_media_disclosure'));
  assert.deepEqual(result.evidence, [evidence('The visuals in this video were generated entirely with AI.')]);
});

test('AI-assisted planning without generated-media disclosure is not classified as generated media', () => {
  const result = classifyAiVideoEvidence({
    disclosures: [evidence('ChatGPT made my workout plan.')],
    metadataAvailable: true,
  });
  assert.equal(result.aiMediaStatus, 'not_ai');
  assert.equal(result.aiAssistedStatus, 'indicated');
  assert.ok(result.reasonCodes.includes('ai_assisted_only'));
});

test('generic AI terms and missing metadata do not become positive media evidence', () => {
  const generic = classifyAiVideoEvidence({
    disclosures: [evidence('AI workout routine ideas')],
    metadataAvailable: true,
  });
  const unavailable = classifyAiVideoEvidence({ disclosures: [], metadataAvailable: false });

  assert.notEqual(generic.aiMediaStatus, 'confirmed');
  assert.notEqual(generic.aiMediaStatus, 'likely');
  assert.equal(unavailable.aiMediaStatus, 'unavailable');
  assert.equal(unavailable.aiAssistedStatus, 'unknown');
});

test('conflicting direct disclosure remains uncertain', () => {
  const result = classifyAiVideoEvidence({
    disclosures: [
      evidence('The video images were generated with AI.'),
      evidence('All footage is original camera video.', 'creator_description'),
    ],
    metadataAvailable: true,
  });

  assert.equal(result.aiMediaStatus, 'uncertain');
});

test('AI-generated media phrasing in creator descriptions is direct evidence', () => {
  const result = classifyAiVideoEvidence({
    disclosures: [evidence('The animations in this video were generated with AI.')],
    metadataAvailable: true,
  });

  assert.equal(result.aiMediaStatus, 'confirmed');
});

test('generic AI-generation hashtags and fragments are never promoted to confirmed or likely', () => {
  for (const text of ['#ai generated video', 'AI generated video']) {
    const result = classifyAiVideoEvidence({
      disclosures: [
        evidence(text, 'creator_description', 'https://example.com/video-1'),
        evidence(text, 'creator_description', 'https://example.com/video-2'),
      ],
      metadataAvailable: true,
    });

    assert.notEqual(result.aiMediaStatus, 'confirmed');
    assert.notEqual(result.aiMediaStatus, 'likely');
  }
});
