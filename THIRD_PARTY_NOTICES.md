# Third-party components

The project's own license has not been selected yet. The proposed MIT license
does not replace any of the third-party licenses below.

## Bundled font

`web/fonts/noto-sans-tc-subset.ttf` is a subset of Noto Sans TC obtained through
Google Fonts. It remains under the SIL Open Font License 1.1. Keep
`web/fonts/OFL.txt` and `web/fonts/README.md` with the font.

The bundled notice identifies Copyright 2014–2021 Adobe, with Reserved Font
Name “Source”. No new rights to the font or its reserved name are granted here.

Sources: [Google Fonts](https://github.com/google/fonts/tree/main/ofl/notosanstc),
[official OFL text](https://openfontlicense.org/open-font-license-official-text/).

## npm dependencies

Versions and license identifiers below were checked against `package-lock.json`
and installed package metadata on 2026-10-17.

| Component | Version | License | Use |
| --- | --- | --- | --- |
| jsonc-parser | 3.3.1 | MIT | Runtime JSONC settings edits |
| gifenc | 1.0.3 | MIT | Development GIF export |
| @resvg/resvg-js and its platform packages | 2.6.2 | MPL-2.0 | Development SVG rasterization |
| playwright and playwright-core | 1.64.1 | Apache-2.0 | Development browser verification |

These packages are installed separately by npm. Their source, native libraries,
and `node_modules` are excluded from the source repository. No changes to their
source are included. Preserve their upstream license/notice files if preparing
a distribution that bundles these dependencies. A future binary distribution
containing resvg must also provide the applicable MPL source information;
see [Mozilla's distribution FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).

Upstream projects: [jsonc-parser](https://github.com/microsoft/node-jsonc-parser),
[gifenc](https://github.com/mattdesl/gifenc),
[resvg-js](https://github.com/thx/resvg-js),
[Playwright](https://github.com/microsoft/playwright).

## Characters and names

The two demo characters are original procedural SVG placeholders rendered by
`src/avatar-svg.mjs`. No third-party character illustration, Live2D model,
Cubism runtime, or proprietary CLI executable is bundled. Imported models and
character art need their own redistribution permission before inclusion.

Codex, Claude, Windows Terminal, and Live2D names identify interoperability
targets. This is an independent community prototype with no claimed endorsement
from their owners.
