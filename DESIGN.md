# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-07
- Primary product surfaces: Electron desktop app, CLI/help documentation, release/social preview assets, installable app icons.
- Evidence reviewed: `README.md`, `src/renderer/public/logo.svg`, `src/renderer/public/favicon.svg`, `src/renderer/public/og-image.svg`, `src/renderer/public/site.webmanifest`, `src/renderer/index.html`, `assets/icon.png`, `assets/icon.ico`, `assets/icons/*`, `electron-builder.json5`.

## Brand
- Personality: fluid, fast, creator-first, technical but approachable.
- Trust signals: polished native app icon, consistent release assets, machine-readable CLI behavior, clear media/caption workflow language.
- Avoid: generic play-button logos, emoji-only branding, cluttered social-media platform collages, low-contrast neon effects.

## Product goals
- Goals: make Flucto recognizable as a media capture/download and transcript-to-Markdown tool; keep the brand clear at app-icon and favicon sizes.
- Non-goals: represent every supported platform in the logo; create a separate brand system outside existing React/Tailwind assets.
- Success signals: icon remains legible at 16px, app/release/web previews share the same wave-download motif, README `🌊 Flucto` heading feels intentional.

## Personas and jobs
- Primary personas: creators, curators, researchers, and automation-heavy users capturing media or captions.
- User jobs: download media, batch process URLs, inspect metadata/formats, export captions/transcripts to Markdown.
- Key contexts of use: desktop app launcher, release download page, GitHub README, CLI output/docs, browser/social previews.

## Information architecture
- Primary navigation: single downloader workspace with settings/history/status surfaces.
- Core routes/screens: Electron renderer entry in `src/renderer/index.html` and React app in `src/renderer/src/App.tsx`.
- Content hierarchy: product name, supported capture/export jobs, status/progress, settings/history.

## Design principles
- Principle 1: Flow first. Visuals should imply smooth capture from URL to local file/Markdown.
- Principle 2: Legibility at small sizes beats decorative detail.
- Tradeoffs: neon/glass polish is acceptable for app identity, but UI controls should remain restrained and readable.

## Visual language
- Color: deep navy/black base with aqua/cyan/blue/violet gradient accents. Current key accent: `#22c8ff`.
- Typography: keep existing app typography; logo assets contain no text except OG/preview cards.
- Spacing/layout rhythm: app icons need generous padding and rounded-square containment.
- Shape/radius/elevation: rounded app tile, soft glow, wave curve flowing into download arrow.
- Motion: if animated later, prefer subtle wave/flow motion; avoid bouncing emoji-like animation.
- Imagery/iconography: primary mark is a stylized wave-download glyph derived from the `🌊` association, not the emoji artwork itself.

## Components
- Existing components to reuse: current renderer components and Tailwind/CSS styling in `src/renderer/src`.
- New/changed components: no React component changes for this logo pass.
- Variants and states: app icon PNG/ICO, favicon SVG, web manifest PNG/SVG, OG SVG.
- Token/component ownership: public brand assets live in `src/renderer/public`; packaged app icons live in `assets`.

## Accessibility
- Target standard: preserve accessible titles/descriptions in SVG assets.
- Keyboard/focus behavior: no interaction changes.
- Contrast/readability: logo uses high-contrast cyan/violet mark on dark tile; OG text remains light on dark.
- Screen-reader semantics: SVGs include `<title>` and `<desc>`.
- Reduced motion and sensory considerations: no animated logo assets added.

## Responsive behavior
- Supported breakpoints/devices: favicon/app icon sizes from 16px through 1024px; OG image at 1200x630.
- Layout adaptations: compact favicon removes extra detail; app icon and OG retain richer glow.
- Touch/hover differences: none for static assets.

## Interaction states
- Loading: unchanged.
- Empty: unchanged.
- Error: unchanged.
- Success: unchanged.
- Disabled: unchanged.
- Offline/slow network, if applicable: unchanged.

## Content voice
- Tone: concise, creator-first, automation-friendly.
- Terminology: use “capture”, “download”, “captions”, “transcripts”, and “Markdown” consistently.
- Microcopy rules: avoid overpromising platform coverage beyond implemented download/transcript support.

## Implementation constraints
- Framework/styling system: Electron + Vite + React + Tailwind/CSS; no stack change.
- Design-token constraints: use existing dark-mode/gradient visual language; do not introduce a new design-system package.
- Performance constraints: keep SVGs static and app icons pre-rendered; no runtime image generation.
- Compatibility constraints: `electron-builder.json5` expects `assets/icon.png` and `assets/icon.ico`; web manifest expects browser-readable public assets.
- Test/screenshot expectations: run build validation after asset changes; visually inspect generated logo before applying.

## Open questions
- [ ] Whether to later add a monochrome tray/menu-bar icon variant / owner: product / impact: platform-native polish.
