import type {
  AiEvidenceReasonCode,
  AiVideoDisclosure,
  AiVideoEvidenceResult,
} from '../../shared/types.js';

export interface AiVideoEvidenceInput {
  disclosures: AiVideoDisclosure[];
  metadataAvailable: boolean;
}

const GENERATED_MEDIA = /\b(?:videos?|visuals?|images?|audio|voices?|footage|animations?|clips?)\b.{0,80}\b(?:generated|created|made|synthesi[sz]ed)\b.{0,40}\b(?:with|by|using)\s+(?:generative\s+)?ai\b|\b(?:ai|artificial intelligence)\b.{0,40}\b(?:generated|created|made|synthesi[sz]ed)\b.{0,40}\b(?:videos?|visuals?|images?|audio|voices?|footage|animations?|clips?)\b/i;
const NOT_GENERATED_MEDIA = /\b(?:videos?|visuals?|images?|audio|voices?|footage|animations?|clips?)\b.{0,80}\b(?:not|never|without)\b.{0,30}\b(?:ai[- ]generated|generated with ai|synthetic)\b|\b(?:original|real|camera)\s+(?:camera\s+)?(?:footage|videos?|recording)\b/i;
const AI_ASSISTANCE = /\b(?:chatgpt|ai|artificial intelligence)\b.{0,60}\b(?:plan|planning|script|recommendation|idea|ideas|recipe|routine|suggestion|advice)\b|\b(?:plan|planning|script|recommendation|idea|ideas|recipe|routine|suggestion|advice)\b.{0,60}\b(?:chatgpt|ai|artificial intelligence)\b/i;

const DIRECT_CREATOR_DISCLOSURE = /\b(?:this|the|my|our|all|these|those)\s+(?:videos?|visuals?|images?|audio|voices?|footage|animations?|clips?)\b.{0,80}\b(?:is|are|was|were|has been|have been)\s+(?:entirely\s+)?(?:ai[- ]generated|(?:generated|created|made|synthesi[sz]ed)\s+(?:entirely\s+)?(?:with|by|using)\s+(?:generative\s+)?ai)\b|\b(?:i|we)\s+(?:generated|created|made|produced|animated)\s+(?:this|the|my|our)\s+(?:video|visuals?|images?|audio|voices?|footage|animations?|clips?)\b.{0,30}\b(?:with|using)\s+(?:generative\s+)?ai\b/i;
const PLATFORM_AI_LABEL = /\bai[- ]generated\b|\bgenerated\s+(?:with|by|using)\s+(?:generative\s+)?ai\b/i;
const GENERIC_AI_HASHTAG = /(?:^|\s)#(?:ai|aigenerated|ai-generated|aivideo|aigeneratedvideo)\b/i;
const GENERIC_AI_FRAGMENT = /^\s*#?(?:ai|artificial intelligence)[-\s]+(?:generated|created|made)\s+(?:videos?|visuals?|images?|audio|voices?|footage|animations?|clips?)(?:\s*(?:,|and|\/)\s*(?:videos?|visuals?|images?|audio|voices?|footage|animations?|clips?))*[.!?]*\s*$/i;

export function classifyAiVideoEvidence(input: AiVideoEvidenceInput): AiVideoEvidenceResult {
  const evidence = input.disclosures;
  if (!input.metadataAvailable) {
    return {
      aiMediaStatus: 'unavailable',
      aiAssistedStatus: 'unknown',
      evidence,
      reasonCodes: ['metadata_unavailable'],
      classificationMethod: 'public-metadata-rules-v1',
      evidenceGrade: 'unavailable',
    };
  }

  const positive = evidence.filter((item) => GENERATED_MEDIA.test(item.text));
  const negative = evidence.filter((item) => NOT_GENERATED_MEDIA.test(item.text));
  const assistance = evidence.some((item) => AI_ASSISTANCE.test(item.text));
  const conflicts = positive.length > 0 && negative.length > 0;
  const hasPlatformLabel = evidence.some((item) => item.source === 'platform_label' && PLATFORM_AI_LABEL.test(item.text));
  const hasCreatorDisclosure = positive.some((item) =>
    (item.source === 'creator_disclosure' || item.source === 'creator_description')
    && DIRECT_CREATOR_DISCLOSURE.test(item.text));
  const independentIndirectDisclosures = new Set(positive
    .filter((item) => item.source !== 'creator_title'
      && !GENERIC_AI_HASHTAG.test(item.text)
      && !GENERIC_AI_FRAGMENT.test(item.text))
    .map((item) => item.url)
    .filter((url): url is string => Boolean(url)));
  const reasonCodes: AiEvidenceReasonCode[] = [];

  let aiMediaStatus: AiVideoEvidenceResult['aiMediaStatus'];
  let evidenceGrade: AiVideoEvidenceResult['evidenceGrade'];
  if (conflicts) {
    aiMediaStatus = 'uncertain';
    evidenceGrade = 'conflicting';
    reasonCodes.push('conflicting_media_disclosures');
  } else if (hasPlatformLabel || hasCreatorDisclosure) {
    aiMediaStatus = 'confirmed';
    evidenceGrade = 'direct';
    if (hasPlatformLabel) reasonCodes.push('platform_ai_label');
    if (hasCreatorDisclosure) reasonCodes.push('creator_media_disclosure');
  } else if (independentIndirectDisclosures.size > 1) {
    aiMediaStatus = 'likely';
    evidenceGrade = 'indirect';
    reasonCodes.push('multiple_indirect_disclosures');
  } else if (positive.length || negative.length) {
    aiMediaStatus = 'uncertain';
    evidenceGrade = 'indirect';
    reasonCodes.push('indirect_media_disclosure');
  } else {
    aiMediaStatus = 'not_ai';
    evidenceGrade = 'none';
    reasonCodes.push(assistance ? 'ai_assisted_only' : 'no_media_disclosure');
  }
  if (assistance && aiMediaStatus !== 'not_ai') reasonCodes.push('ai_assistance_indicated');

  return {
    aiMediaStatus,
    aiAssistedStatus: assistance ? 'indicated' : 'not_indicated',
    evidence,
    reasonCodes,
    classificationMethod: 'public-metadata-rules-v1',
    evidenceGrade,
  };
}
