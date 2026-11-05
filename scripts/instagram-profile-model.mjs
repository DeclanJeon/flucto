// Read-only DOM projection: executed by agbrowse, never reads cookies or hidden API data.
export function observeInstagramPage(doc = document) {
  const visible = e => Boolean(e.getClientRects().length);
  const links = root => [...root.querySelectorAll('a[href]')].filter(visible)
    .map(a => ({ text: a.innerText.trim(), url: a.href }));
  const header = doc.querySelector('header');
  let authorRoot = doc.querySelector('article header') ?? doc.querySelector('main header');
  // Div-only post layouts still expose the options/follow row. Never use comments.
  if (!authorRoot) {
    const options = [...doc.querySelectorAll('main svg[aria-label]')]
      .find(e => /^(옵션 더 보기|More options)$/.test(e.getAttribute('aria-label')));
    let row = options?.parentElement;
    for (let depth = 0; row && depth < 8; depth += 1, row = row.parentElement) {
      if (row.querySelectorAll('a[href]').length && row.innerText.length < 500 && /팔로우|Follow/i.test(row.innerText)) {
        authorRoot = row;
        break;
      }
    }
  }
  return {
    url: location.href,
    pageText: (doc.querySelector('main') ?? doc.body).innerText.slice(0, 6000),
    headerText: header?.innerText ?? '',
    headerLinks: header ? links(header) : [],
    authorLinks: authorRoot ? links(authorRoot) : [],
    links: links(doc.querySelector('[role="dialog"]') ?? doc.querySelector('main') ?? doc.body),
  };
}

export class EnrichmentError extends Error {
  constructor(code, message) { super(message); this.name = 'EnrichmentError'; this.code = code; }
}

const reserved = new Set(['p', 'reel', 'reels', 'accounts', 'explore', 'direct', 'stories', 'about', 'challenge']);
export function instagramTarget(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname)
      || url.username || url.password || url.port) throw new EnrichmentError('input', 'Expected a public HTTPS Instagram URL');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 1 && /^[a-z\d._]{1,30}$/i.test(parts[0]) && !reserved.has(parts[0].toLowerCase())) {
    return { kind: 'profile', handle: parts[0].toLowerCase(), url: `https://www.instagram.com/${parts[0].toLowerCase()}/` };
  }
  if (parts.length === 2 && ['p', 'reel'].includes(parts[0]) && /^[\w-]+$/.test(parts[1])) {
    return { kind: 'post', handle: null, url: `https://www.instagram.com/${parts[0]}/${parts[1]}/` };
  }
  throw new EnrichmentError('input', 'Unsupported Instagram URL shape');
}

export function parseObservation(raw) {
  if (!raw || typeof raw !== 'object' || !['url', 'pageText', 'headerText'].every(k => typeof raw[k] === 'string')
      || !['headerLinks', 'authorLinks', 'links'].every(k => Array.isArray(raw[k])
        && raw[k].every(v => v && typeof v.text === 'string' && typeof v.url === 'string'))) {
    throw new EnrichmentError('protocol', 'Unexpected browser observation');
  }
  return raw;
}

export function pageGate(observation) {
  const path = new URL(observation.url).pathname;
  if (/^\/(accounts\/login|challenge|checkpoint)(\/|$)/.test(path)
      || /confirm you.re human|verify you are human|보안 확인|로봇이 아님|captcha/i.test(observation.pageText)) return 'auth_or_challenge';
  if (/try again later|we restrict certain activity|잠시 후 다시 시도|활동이 제한|자동화된 행동/i.test(observation.pageText)) return 'rate_limited';
  return null;
}

export function externalLink(value) {
  try {
    const input = new URL(value);
    const url = input.hostname === 'l.instagram.com' ? new URL(input.searchParams.get('u') ?? '') : input;
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port
        || !url.hostname.includes('.') || /(^|\.)(localhost|local|internal)$/.test(url.hostname)
        || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')
        || /(^|\.)(instagram.com|threads.com|facebook.com)$/.test(url.hostname)) return null;
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_') || ['fbclid', 'igsh', 'igshid', 'NaPm'].includes(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.href;
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }
}

export function isLinkHub(value) {
  return ['litt.ly', 'link.inpock.co.kr', 'inpk.link'].includes(new URL(value).hostname);
}

export function multipleLinksRef(snapshot) {
  return snapshot.match(/^\s*(e\d+)\s+button\s+"[^"\n]*(?:외\s*\d+\s*개|and\s+\d+\s+others)[^"\n]*"/m)?.[1] ?? null;
}

export function classifyLink(text) {
  if (/고객센터|상담|설명서|배송|문의|가이드|공지방|카톡방|카카오|kakao|\bcs\b|contact|support/i.test(text)) return 'other';
  if (/자사몰|스토어|쇼핑|마켓|주문|커머스|구매|공구|특가|할인|오픈|open|shop|store|구매하기/i.test(text)) return 'promotion';
  return 'candidate';
}

export function profileFromObservation(observation, target) {
  const gate = pageGate(observation);
  if (gate) return { status: gate, profileUrl: target.url, handle: target.handle, followerDisplay: null, links: [] };
  const current = instagramTarget(observation.url);
  const identity = observation.headerLinks.some(link => {
    try { return instagramTarget(link.url).handle === target.handle && link.text === target.handle; }
    catch (error) { if (error instanceof EnrichmentError || error instanceof TypeError) return false; throw error; }
  });
  if (current.handle !== target.handle || !identity) {
    return { status: 'identity_unconfirmed', profileUrl: target.url, handle: target.handle, followerDisplay: null, links: [] };
  }
  const followers = observation.headerLinks.map(v => v.text)
    .filter(text => /^(팔로워\s*[\d.,]+\s*[만천억]?\s*명?|[\d.,]+\s*[KMB]?\s+followers)$/i.test(text));
  const links = observation.headerLinks.flatMap(link => {
    const url = externalLink(link.url);
    return url ? [{ url, label: link.text, sourceUrl: target.url, kind: isLinkHub(url) ? 'hub' : classifyLink(link.text) }] : [];
  });
  return { status: followers.length === 1 ? 'observed' : 'followers_unavailable', profileUrl: target.url,
    handle: target.handle, followerDisplay: followers.length === 1 ? followers[0] : null, links };
}

export function authorFromObservation(observation) {
  const candidates = new Map();
  for (const link of observation.authorLinks) {
    try {
      const target = instagramTarget(link.url);
      if (target.kind === 'profile' && link.text.replace(/\s*인증됨$/, '').trim() === target.handle) candidates.set(target.handle, target);
    } catch (error) { if (!(error instanceof EnrichmentError || error instanceof TypeError)) throw error; }
  }
  if (candidates.size !== 1) throw new EnrichmentError('author_ambiguous', 'Expected exactly one post-header author; comments are not author evidence');
  return [...candidates.values()][0];
}

export function hubLinks(observation) {
  return observation.links.flatMap(link => {
    const url = externalLink(link.url);
    return url && link.text ? [{ url, label: link.text, sourceUrl: observation.url, kind: classifyLink(link.text) }] : [];
  });
}

export function inputTargets(raw) {
  const values = Array.isArray(raw) ? raw : raw?.videos?.map(v => v.originalUrl);
  if (!Array.isArray(values) || !values.length || values.some(v => typeof v !== 'string')) {
    throw new EnrichmentError('input', 'Expected nonempty URL array or Flucto videos[].originalUrl');
  }
  return [...new Map(values.map(value => { const target = instagramTarget(value); return [target.url, target]; })).values()];
}
