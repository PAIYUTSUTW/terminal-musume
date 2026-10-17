// Original, code-drawn placeholders. These are not ZipZipPipe artwork and are
// not Live2D rigs. Replace the exported GIF slots with your own model renders.
export function avatarSVG(provider, state, seconds, width = 360, height = 520) {
  const dragon = provider === 'codex';
  const hair = dragon ? '#eeeef7' : '#e88b59';
  const darkHair = dragon ? '#b8bacf' : '#b95b3d';
  const lightHair = dragon ? '#ffffff' : '#ffbf80';
  const accent = dragon ? '#8bd4b6' : '#f2bd70';
  const ink = dragon ? '#48445e' : '#66433c';
  const tau = seconds / 2.4 * Math.PI * 2;
  const breathe = Math.sin(tau);
  const tilt = Math.sin(tau) * (state === 'happy' ? 4 : 1.4);
  const sway = Math.sin(tau + .5) * 3;
  const blink = seconds > .9 && seconds < 1.05;
  const happy = state === 'happy';
  const concerned = state === 'concerned';
  const talking = state === 'explaining' || state === 'happy';
  const gaze = state === 'thinking' ? -4 : state === 'waiting' ? 4 : Math.sin(tau) * 1.2;
  const eyes = (x) => blink || happy
    ? `<path d="M${x-15} 183 Q${x} ${happy ? 163 : 188} ${x+15} 183" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`
    : `<ellipse cx="${x}" cy="182" rx="15" ry="19" fill="#fffdf9"/><ellipse cx="${x+gaze}" cy="184" rx="9.5" ry="15" fill="${dragon ? '#6bb79c' : '#a26546'}"/><ellipse cx="${x+gaze}" cy="186" rx="4.8" ry="10" fill="${ink}"/><ellipse cx="${x+gaze-3}" cy="177" rx="3.5" ry="5" fill="#fff"/><path d="M${x-15} 174 Q${x} 163 ${x+15} 174" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`;
  const badge = state === 'thinking' ? `<circle cx="282" cy="101" r="18" fill="#fff7e7"/><path d="M277 95 Q277 88 284 90 Q292 92 284 100 L284 104 M284 110 L284 112" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`
    : concerned ? `<path d="M278 108 Q260 134 278 135 Q295 133 278 108" fill="#92c8de"/>`
    : happy ? `<path d="M280 85 L285 100 L300 104 L285 109 L280 124 L275 109 L260 104 L275 100 Z" fill="${accent}" opacity="${.6 + .4*Math.sin(tau)**2}"/><path d="M70 145 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 Z" fill="${accent}"/>`
    : state === 'waiting' ? `<circle cx="279" cy="106" r="19" fill="#fff6e6" stroke="${accent}" stroke-width="3"/><path d="M279 94 V106 L287 111" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 360 520">
  <defs><linearGradient id="hair" x2="0.3" y2="1"><stop stop-color="${lightHair}"/><stop offset=".55" stop-color="${hair}"/><stop offset="1" stop-color="${darkHair}"/></linearGradient><linearGradient id="dress" x2="0.8" y2="1"><stop stop-color="#fffaf0"/><stop offset="1" stop-color="${dragon ? '#dce9e5' : '#e8dcd3'}"/></linearGradient></defs>
  <g transform="translate(0 ${-breathe*1.6})" stroke="${ink}" stroke-width="2.2" stroke-linejoin="round">
    ${dragon ? `<g transform="rotate(${sway} 180 290)"><path d="M120 296 Q65 222 39 257 Q77 262 53 293 Q93 273 88 314 Z" fill="#d8e6e4"/><path d="M238 297 Q291 221 320 257 Q282 261 306 294 Q266 274 271 313 Z" fill="#d8e6e4"/><path d="M223 398 Q298 422 279 462 Q267 489 244 469 Q269 471 258 454 Q245 443 211 441" fill="${hair}"/></g>` : ''}
    <path d="M111 153 Q87 240 ${91+sway} 354 Q79 386 105 407 L128 387 L143 211 M249 153 Q274 250 ${270-sway} 354 Q282 388 255 407 L231 385 L216 205" fill="url(#hair)"/>
    <path d="M142 429 L140 478 Q149 485 162 478 L170 426 M192 426 L198 478 Q212 485 221 477 L220 428" fill="#fff4e8"/>
    <path d="M139 461 L137 485 Q124 495 135 500 L165 499 L164 462 M197 462 L198 499 L228 500 Q238 493 221 485 L220 462" fill="${dragon ? '#e8edef' : '#535064'}"/>
    <path d="M143 266 Q179 246 217 267 L223 328 L249 424 Q182 456 111 425 L137 326 Z" fill="${dragon ? 'url(#dress)' : '#535064'}"/>
    <path d="M152 265 L179 281 L207 265 L211 327 L225 416 Q181 432 135 416 L150 327 Z" fill="url(#dress)"/>
    <path d="M112 421 Q121 433 131 426 Q141 441 153 432 Q165 446 180 436 Q197 444 208 432 Q223 440 232 427 Q244 435 250 421 L249 435 Q180 465 110 435 Z" fill="#fff8ee"/>
    <path d="M147 323 Q180 336 215 323 L218 338 Q180 350 144 338 Z" fill="${accent}"/>
    <path d="M179 279 L162 269 L162 294 L179 286 L197 295 L197 270 Z" fill="${accent}"/><circle cx="180" cy="283" r="5" fill="#fff6db"/>
    <g transform="rotate(${state === 'working' ? Math.sin(tau*2)*4 : 0} 146 275)"><path d="M145 268 Q121 259 112 282 L101 337 L120 344 L147 296" fill="url(#dress)"/><path d="M102 335 L99 363 Q105 375 116 366 L121 341" fill="#fff0df"/></g>
    <g transform="rotate(${state === 'happy' ? -20 + Math.sin(tau)*8 : state === 'explaining' ? -10 : 0} 213 276)"><path d="M213 269 Q239 260 247 285 L257 336 L238 344 L211 297" fill="url(#dress)"/><path d="M239 340 L244 365 Q258 374 262 361 L257 336" fill="#fff0df"/></g>
    ${state === 'working' ? `<g transform="translate(0 ${Math.sin(tau*2)})"><path d="M112 343 H246 L235 380 H123 Z" fill="#5d637b"/><path d="M125 350 H233 M124 358 H231 M123 366 H229 M143 348 L139 371 M164 348 L162 371 M186 348 V371 M207 348 L210 371" stroke="#bdc8d5" stroke-width="2"/></g>` : ''}
    <g transform="rotate(${tilt} 180 232)">
      ${dragon ? `<path d="M123 116 Q101 96 112 68 Q116 88 139 91 M221 113 Q253 96 246 68 Q237 88 218 91" fill="#e1dcc7"/>` : ''}
      <path d="M113 169 Q98 188 115 202 M246 168 Q263 186 246 201" fill="#ffecdb"/>
      <path d="M112 151 Q113 101 181 102 Q249 106 248 160 L243 199 Q235 238 180 245 Q128 239 116 200 Z" fill="#fff0df"/>
      <path d="M109 171 Q90 97 143 78 Q213 55 245 107 Q263 140 249 180 L234 144 Q224 155 214 148 L204 115 Q186 153 159 152 L168 119 Q148 153 119 151 Z" fill="url(#hair)"/>
      <path d="M131 110 Q147 93 162 96 M181 88 Q212 84 231 111" stroke="${lightHair}" stroke-width="7" fill="none" stroke-linecap="round" opacity=".75"/>
      ${eyes(148)}${eyes(212)}
      <path d="M133 158 Q148 ${concerned ? 164 : 153} 161 158 M199 158 Q212 ${concerned ? 164 : 153} 226 158" stroke="${darkHair}" stroke-width="3" fill="none"/>
      <ellipse cx="128" cy="207" rx="13" ry="5" fill="#ef9f99" opacity=".45" stroke="none"/><ellipse cx="232" cy="207" rx="13" ry="5" fill="#ef9f99" opacity=".45" stroke="none"/>
      ${talking ? `<ellipse cx="180" cy="219" rx="${happy ? 9 : 5}" ry="${3+Math.abs(Math.sin(tau*4))*6}" fill="#c87977"/>` : `<path d="M172 ${concerned ? 222 : 216} Q180 ${concerned ? 214 : 224} 188 ${concerned ? 222 : 216}" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linecap="round"/>`}
      ${dragon ? `<path d="M238 125 l8 -12 8 12 -8 12 Z" fill="${accent}"/><circle cx="247" cy="125" r="3" fill="#fff"/>` : `<g fill="#fff3d8"><ellipse cx="113" cy="124" rx="7" ry="13"/><ellipse cx="113" cy="124" rx="7" ry="13" transform="rotate(60 113 124)"/><ellipse cx="113" cy="124" rx="7" ry="13" transform="rotate(120 113 124)"/><circle cx="113" cy="124" r="5" fill="${accent}"/></g>`}
    </g>${badge}
  </g></svg>`;
}
