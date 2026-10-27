const fs = require('node:fs');
const path = require('node:path');
const { getCatalog } = require('../src/catalog');

const out = path.join(__dirname, '..', 'public', 'art');
fs.mkdirSync(out, { recursive: true });
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const line = (x1, y1, x2, y2, color = '#ffffff66', width = 3) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${color}" stroke-width="${width}"/>`;
const ring = (x, y, r, color, width = 5) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${color}" stroke-width="${width}"/>`;

function scene(game, index) {
  const c = game.color;
  const beam = `<path d="M0 275L600 40L720 85L180 320Z" fill="${c}" opacity=".09"/>`;
  const sight = (x, y, r) => `${ring(x, y, r, c, 9)}${ring(x, y, r * .48, '#ffffff88', 3)}${line(x-r-34,y,x+r+34,y,'#ffffff99',3)}${line(x,y-r-34,x,y+r+34,'#ffffff99',3)}<circle cx="${x}" cy="${y}" r="7" fill="#fff"/>`;
  if (['cop-vr', 'time-crisis-vr', 'time-crisis-2-vr', 'dr89-time-crisis', 'dr89-time-crisis-2', 'crisis-zone-vr'].includes(game.id)) {
    const x = 435 + (index % 3) * 30;
    const y = 136 + (index % 2) * 19;
    return `${beam}<path d="M48 275V120h86V80h82v70h68V88h70v187" fill="none" stroke="#dbe7ff33" stroke-width="5"/><path d="M0 276h720" stroke="#ffffff33" stroke-width="3"/>${sight(x,y,67)}<path d="M60 260L312 24M90 260L342 24" stroke="${c}" stroke-width="3" opacity=".38"/>`;
  }
  if (game.id === 'hotd-vr' || game.id === 'hotd2-vr') {
    return `<circle cx="495" cy="112" r="95" fill="${c}" opacity=".22"/>${ring(495,112,95,'#ffffff55',2)}<path d="M205 278V128l120-80 120 80v150M240 278V143h170v135M276 278V200h32v78M345 278V200h32v78" fill="#0b121d" stroke="${c}" stroke-width="5"/><path d="M240 150h170M250 180h150" stroke="#ffffff4b" stroke-width="2"/><path d="M460 272c19-58 38-57 53 0m30 0c17-47 34-46 47 0" fill="none" stroke="#ffffff55" stroke-width="5"/>`;
  }
  if (['rally-vr','dirt-dash-vr','nfsu-vr','nfsu2-vr','wii-compiled','revolt-vr','wipeout-vr','road-rash-vr'].includes(game.id)) {
    const hover = game.id === 'wipeout-vr';
    const bike = game.id === 'road-rash-vr';
    return `<circle cx="500" cy="103" r="102" fill="${c}" opacity=".18"/><path d="M250 280L340 75h55L520 280" fill="#0b1821" stroke="${c}" stroke-width="4"/><path d="M370 102v42m0 22v42m0 22v50" stroke="#ffe9b7" stroke-width="5" stroke-dasharray="16 16"/><path d="M70 125L285 165M60 153l210 35M120 97l180 48" stroke="#ffffff47" stroke-width="4"/>${bike ? `<circle cx="440" cy="226" r="27" fill="#0d1720" stroke="#fff" stroke-width="6"/><circle cx="550" cy="226" r="27" fill="#0d1720" stroke="#fff" stroke-width="6"/><path d="M440 226l35-52 37 45 38 7-29-60h-39l-11 18" fill="none" stroke="${c}" stroke-width="12"/>` : hover ? `<path d="M350 205l174-37 117 33-190 39Z" fill="${c}" stroke="#fff" stroke-width="4"/><path d="M366 240l75 18 180-35" fill="none" stroke="${c}" stroke-width="9"/>` : `<path d="M365 203h202l29 44H340Z" fill="${c}" stroke="#ffffffcc" stroke-width="5"/><path d="M397 195l34-43h110l35 43" fill="#172433" stroke="#ffffff99" stroke-width="5"/><circle cx="387" cy="250" r="20" fill="#0b1019" stroke="#fff" stroke-width="5"/><circle cx="545" cy="250" r="20" fill="#0b1019" stroke="#fff" stroke-width="5"/>`}`;
  }
  if (game.id === 'sm64-vr') return `<circle cx="485" cy="116" r="105" fill="${c}" opacity=".20"/><path d="M40 280h145v-87h102v87h86v-120h97v120h250" fill="#182d49" stroke="${c}" stroke-width="5"/><path d="M275 280v-110h97v110M318 170v110" stroke="#ffffff88" stroke-width="4"/>${ring(320,91,35,'#ffe29a',8)}<path d="M320 71v40M65 241h90M70 215h76" stroke="#fff" stroke-width="5"/>`;
  if (['oot-vr','mm-vr','twilight-vr'].includes(game.id)) {
    return `<circle cx="509" cy="100" r="101" fill="${c}" opacity=".23"/>${game.id === 'mm-vr' ? `<path d="M485 16a88 88 0 1 0 90 154A99 99 0 0 1 485 16" fill="#e8d9ff" opacity=".7"/>` : ''}<path d="M0 268l190-164 122 130 112-171 175 205Z" fill="#15243a" stroke="#ffffff66" stroke-width="3"/><path d="M235 279l64-196 23 196M271 94h59M250 151h93" fill="${c}" stroke="#fff" stroke-width="5"/><path d="M50 280h640" stroke="#ffffff77" stroke-width="3"/>`;
  }
  if (game.id === 'xelee') return `<circle cx="360" cy="125" r="116" fill="${c}" opacity=".21"/><path d="M0 268l190-110 170 110 170-110 190 110" fill="none" stroke="#ffffff5c" stroke-width="5"/><path d="M165 236l68-111 41 21-47 92M530 236l-68-111-41 21 47 92" fill="${c}" stroke="#ffffffb3" stroke-width="5"/><path d="M275 153l85 71 85-71" fill="none" stroke="#fff" stroke-width="8"/>`;
  if (game.id === 'quest-strikers') return `<ellipse cx="375" cy="267" rx="320" ry="103" fill="none" stroke="${c}" stroke-width="7"/><path d="M375 165v205M48 267h650" stroke="#ffffff77" stroke-width="4"/>${ring(375,267,67,'#ffffff88',4)}<circle cx="540" cy="115" r="66" fill="#e8edf2"/><path d="M540 68l31 25-14 34h-36l-14-34Z" fill="#18202c"/><path d="M540 181l-10-28m59-23-23-8m-77-19 20 4" stroke="#18202c" stroke-width="9"/>`;
  if (game.id === 'halo-ce') return `<circle cx="510" cy="94" r="117" fill="none" stroke="${c}" stroke-width="13" opacity=".8"/><path d="M0 255l132-91 116 93 125-72 132 70 96-62 119 62" fill="#173729" stroke="#e0ffe188" stroke-width="4"/><path d="M350 265v-123l50-57 60 57v123Z" fill="#0f221b" stroke="${c}" stroke-width="6"/><path d="M367 159h78v38h-78Z" fill="${c}" opacity=".75"/>`;
  if (game.id === 'mgs-vr') return `<path d="M50 270h620M95 270V90h146v180M480 270V65h98v205" stroke="#ffffff44" stroke-width="4" fill="none"/><path d="M315 270v-130l52-45 51 45v130" fill="#101d1b" stroke="${c}" stroke-width="6"/><path d="M270 75l210 195h-60L250 130" fill="${c}" opacity=".18"/>${ring(365,126,31,'#ffffffaa',4)}<path d="M325 154h80" stroke="${c}" stroke-width="10"/>`;
  if (['lambda1vr','quakequest','quake2quest','rtcwquest'].includes(game.id)) return `<circle cx="515" cy="101" r="92" fill="${c}" opacity=".2"/><path d="M0 270l125-93 111 79 126-114 113 92 116-137 129 173" fill="#17232f" stroke="#ffffff55" stroke-width="4"/><path d="M54 275V182h81v93M166 275V119h77v156M295 275V193h95v82M452 275V101h64v174" fill="#111924" stroke="${c}" stroke-width="4"/><path d="M382 260l58-83 69 10 29 73Z" fill="${c}" stroke="#ffffffad" stroke-width="5"/><path d="M420 177v-46l18-14M510 189l26-62" stroke="#fff" stroke-width="5"/>${ring(467,192,34,'#fff9',3)}`;
  return `${beam}${ring(420,130,100,c,12)}<path d="M100 275L440 20M180 275L520 20" stroke="#ffffff77" stroke-width="4"/>`;
}

function svgFor(game, index) {
  const title = game.title.replace(/\s*\([^)]*\)/g, '');
  const display = title.length > 25 ? title.replace(/ VR$/, '') : title;
  const fontSize = display.length > 25 ? 31 : display.length > 19 ? 36 : 42;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 380" role="img" aria-labelledby="title desc">
  <title id="title">${esc(game.title)} artwork</title><desc id="desc">Original illustrated ${esc(game.genre.toLowerCase())} scene for ${esc(game.title)}</desc>
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#0b1423"/><stop offset=".55" stop-color="#1a2537"/><stop offset="1" stop-color="${game.color}" stop-opacity=".6"/></linearGradient><linearGradient id="shade" x2="0" y2="1"><stop stop-color="#08111b" stop-opacity="0"/><stop offset="1" stop-color="#050a12" stop-opacity=".96"/></linearGradient></defs>
  <rect width="720" height="380" fill="url(#bg)"/><path d="M0 50h720M0 105h720M0 160h720M0 215h720M0 270h720M90 0v380M180 0v380M270 0v380M360 0v380M450 0v380M540 0v380M630 0v380" stroke="#ffffff0b" stroke-width="2"/>
  ${scene(game,index)}
  <rect y="224" width="720" height="156" fill="url(#shade)"/><path d="M35 310h85" stroke="${game.color}" stroke-width="6"/>
  <text x="36" y="41" fill="#ffffffa8" font-size="15" font-family="Arial,sans-serif" letter-spacing="4">VR4ALL  /  ${esc(game.console.toUpperCase())}</text>
  <text x="36" y="358" fill="#f7f9ff" font-size="${fontSize}" font-weight="800" font-family="Arial,sans-serif" letter-spacing="1">${esc(display.toUpperCase())}</text>
  </svg>\n`;
}

for (const [index, game] of getCatalog().entries()) fs.writeFileSync(path.join(out, `${game.id}.svg`), svgFor(game, index));
fs.writeFileSync(path.join(out, 'custom.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 380"><title>Custom port artwork</title><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#141b35"/><stop offset="1" stop-color="#776dc1"/></linearGradient></defs><rect width="720" height="380" fill="url(#bg)"/><circle cx="500" cy="172" r="116" fill="none" stroke="#d0caff" stroke-width="14"/><path d="M500 93v158M421 172h158" stroke="#fff" stroke-width="14"/><text x="35" y="344" fill="white" font-family="Arial,sans-serif" font-size="46" font-weight="bold">YOUR PORT</text></svg>\n`);
console.log(`Generated ${getCatalog().length + 1} original SVG illustrations`);
