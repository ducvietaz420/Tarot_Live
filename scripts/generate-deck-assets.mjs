import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Original code-native artwork; no network resources or external illustration sources.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'assets', 'cards');
mkdirSync(out, { recursive: true });
const gold = '#e5c58b', pale = '#f5e8cb', cyan = '#8bc9cb';
const roman = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];
const names = ['the-fool', 'the-magician', 'the-high-priestess', 'the-empress', 'the-emperor', 'the-hierophant', 'the-lovers', 'the-chariot', 'strength', 'the-hermit', 'wheel-of-fortune', 'justice', 'the-hanged-man', 'death', 'temperance', 'the-devil', 'the-tower', 'the-star', 'the-moon', 'the-sun', 'judgement', 'the-world'];

const star = (x, y, r = 5, color = gold) => `<path d="M${x} ${y-r}L${x+r*.3} ${y-r*.3}L${x+r} ${y}L${x+r*.3} ${y+r*.3}L${x} ${y+r}L${x-r*.3} ${y+r*.3}L${x-r} ${y}L${x-r*.3} ${y-r*.3}Z" fill="${color}" stroke="none"/>`;
const ellipse = (cx, cy, rx, ry, attrs='') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${attrs}/>`;
const circle = (cx, cy, r, attrs='') => `<circle cx="${cx}" cy="${cy}" r="${r}" ${attrs}/>`;
const rays = (x, y, r1, r2, count=16) => Array.from({length:count},(_,i)=> { const a=i/count*Math.PI*2; return `<path d="M${x+Math.cos(a)*r1} ${y+Math.sin(a)*r1}L${x+Math.cos(a)*r2} ${y+Math.sin(a)*r2}"/>`; }).join('');
const hill = `<path d="M30 365L79 292L122 337L180 278L270 365V429H30Z" fill="#211d38" stroke="#695773"/><path d="M35 390Q95 352 154 390T270 386M35 408Q105 380 176 408T270 407" opacity=".35"/>`;
const branch = (x,y,side=1) => `<g transform="translate(${x} ${y}) scale(${side} 1)"><path d="M0 0Q-26-64-3-137"/>${[-18,-44,-70,-96,-120].map((n,i)=>`<path d="M${i%2?-10:-13} ${n}Q${i%2?-37:11} ${n-13} ${i%2?-26:10} ${n-29}Q${i%2?-10:-9} ${n-25} ${i%2?-10:-13} ${n}" fill="#6f8580" stroke="${gold}" stroke-width=".8"/>`).join('')}</g>`;
const halo = (x=150,y=201,r=72) => `<g stroke="${gold}" opacity=".7">${circle(x,y,r)}${circle(x,y,r-7)}${rays(x,y,r+7,r+15,20)}</g>`;
const moon = (x,y,r=45) => `<path d="M${x+r*.35} ${y-r*.94}A${r} ${r} 0 1 0 ${x+r*.35} ${y+r*.94}A${r*.78} ${r*.78} 0 0 1 ${x+r*.35} ${y-r*.94}Z" fill="${gold}" stroke="none"/>`;
const figure = (x=150,y=190,scale=1,color='#7c4e9b') => `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M-46 188L-34 72Q-52 36-19 19Q-32-10 0-14Q32-10 19 19Q52 36 34 72L46 188Z" fill="${color}"/><path d="M-10 15Q0 27 10 15L10 34L0 44L-10 34Z" fill="#d4b9aa" stroke="none"/>${ellipse(0,0,17,23,'fill="#d4b9aa" stroke="none"')}<path d="M-20 8Q-25-32 0-29Q28-31 21 12L13-7Q0-12-14-6Z" fill="#221b33" stroke="${gold}" stroke-width="1"/><path d="M-34 57L0 93L34 57M0 44V186M-28 87L-37 181M28 87L37 181" opacity=".6"/><path d="M-33 55L-63 107L-35 117M33 55L63 107L35 117" fill="${color}"/></g>`;
const vessel = (x,y,s=1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-16-16H16L12 5Q0 20-12 5Z" fill="#a18c71"/><path d="M0 14V30M-12 31H12"/></g>`;
const eye = (x,y,s=1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-38 0Q0-34 38 0Q0 34-38 0Z"/>${circle(0,0,13,'fill="#312647"')}${circle(0,0,4,`fill="${gold}"`)}</g>`;
const crown = (x,y,s=1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-28 9L-36-16L-14-7L0-29L14-7L36-16L28 9Z" fill="#9b754c"/>${circle(0,-30,3,`fill="${pale}"`)}<path d="M-26 17H26M-17 1H17"/></g>`;
const scales = (x,y,s=1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0-42V69M-30 69H30M-58-20H58M0-42L-8-30H8Z"/><path d="M-46-19L-69 26H-23ZM46-19L23 26H69Z" fill="#4e436a"/><path d="M-70 26Q-46 49-22 26M22 26Q46 49 70 26" fill="#aa8c5f"/></g>`;
const key = (x,y,s=1) => `<g transform="translate(${x} ${y}) scale(${s})">${circle(0,-28,15)}${circle(0,-28,7)}<path d="M0-13V47M0 29H18V36M0 41H13V48"/></g>`;
const chalice = `<path d="M-24-30H24L20-6Q16 11 0 13Q-16 11-20-6Z" fill="#8b849f"/><path d="M0 13V39M-19 40H19M-24-23H-32Q-42 1-18 2M24-23H32Q42 1 18 2"/>`;
const wand = `<path d="M-4 45L-1-43L6-46L4 45Z" fill="#a98669"/><path d="M0-22Q-25-37-18-49Q1-46 0-22ZM3-2Q24-22 25-8Q15 2 3-2Z" fill="#7d9b87" stroke-width="1"/>${star(3,-57,6)}`;
const sword = `<path d="M-5 19L-5-44L0-57L5-44V19Z" fill="#afc9cf"/><path d="M0-46V19M-19 20H19M0 22V45M-8 45H8"/><path d="M-19 17Q-8 25 0 20Q8 25 19 17"/>`;
const pentacle = `${circle(0,0,28,'fill="#8c7655"')}${circle(0,0,23)}<path d="M0-20L12 17L-19-6H19L-12 17Z" fill="none"/>`;
const motifs = { wands: wand, cups: chalice, swords: sword, pentacles: pentacle };

function majorArt(i) {
  switch(i) {
    case 0: return `${hill}${circle(219,132,28,'fill="#caab70" stroke="none"')}${figure(144,210,.84,'#8c669f')}<path d="M162 251L215 182L228 190M128 390L91 409M154 388L184 410"/><path d="M51 367Q70 340 88 365L80 381H57Z" fill="#c6c2cb"/><path d="M53 361L47 345L65 352M78 360L87 344L89 367"/>${star(73,159,10)}`;
    case 1: return `${halo(150,177,57)}${figure(150,211,.88,'#804d91')}<path d="M101 262L83 154M82 154L79 124M182 272L220 338"/><path d="M67 343H232V358H67ZM79 358V414M221 358V414" fill="#7e637d"/>${vessel(96,324,.5)}<g transform="translate(142 326) scale(.4)">${sword}</g><g transform="translate(189 330) scale(.4)">${pentacle}</g><path d="M131 158C112 145 129 129 149 145C171 126 187 147 169 158C157 168 143 143 131 158Z"/>`;
    case 2: return `<path d="M47 145H83V403H47ZM217 145H253V403H217Z" fill="#413851"/><path d="M43 134H87V148H43ZM213 134H257V148H213Z"/>${moon(150,151,31)}${figure(150,217,.98,'#536b9d')}<path d="M115 319H186L182 348H119Z" fill="#cabca0"/><path d="M137 320V348M150 320V348M163 320V348" opacity=".35"/>${moon(151,411,18)}`;
    case 3: return `${halo(150,194,65)}${figure(150,218,.95,'#9b6a88')}${crown(150,172,.58)}${branch(61,426)}${branch(239,426,-1)}<path d="M99 384Q150 365 201 384L210 416H90Z" fill="#77634f"/><path d="M95 401H205"/>${circle(221,305,22)}<path d="M221 327V352M209 342H233"/>`;
    case 4: return `<path d="M74 172L89 143H211L226 172V414H74Z" fill="#484359"/><path d="M89 170H211V396H89Z"/><path d="M77 165L61 147L64 126L84 129L91 147M223 165L239 147L236 126L216 129L209 147" fill="#857889"/>${figure(150,212,.92,'#8e5d78')}${crown(150,168,.58)}<path d="M95 305L81 239M81 239V220M72 230H90M198 300V374"/>${circle(198,290,12,'fill="#ae966d"')}`;
    case 5: return `<path d="M51 157H78V415H51ZM222 157H249V415H222Z" fill="#655471"/>${halo(150,191,50)}${figure(150,215,.95,'#725780')}${crown(150,169,.55)}<path d="M150 155V109M138 120H162M132 134H168M127 147H173M191 285L205 257L218 265"/>${key(120,396,.4)}<g transform="rotate(45 180 390)">${key(180,390,.4)}</g>`;
    case 6: return `${halo(150,181,62)}${star(150,170,20)}<path d="M91 210Q150 243 209 210Q150 295 91 210Z" fill="#b9849e" stroke="none"/>${figure(90,273,.64,'#817f9c')}${figure(210,273,.64,'#926387')}<path d="M108 340Q150 313 192 340"/><path d="M31 415L95 367L151 411L214 362L270 415" fill="#1f3543"/>${branch(43,382)}${branch(257,382,-1)}`;
    case 7: return `${halo(150,175,51)}<path d="M77 314H223L213 399H87Z" fill="#6a647b"/>${figure(150,212,.7,'#637890')}${crown(150,176,.5)}<path d="M61 129H239L227 155H73Z" fill="#5f477d"/>${star(90,140,6)}${star(150,140,6)}${star(210,140,6)}<path d="M76 154L77 319M225 154V319M126 340L150 361L174 340"/>${circle(102,395,19,'fill="#5d536b"')}${circle(198,395,19,'fill="#5d536b"')}${rays(102,395,5,15,8)}${rays(198,395,5,15,8)}`;
    case 8: return `${halo(150,187,61)}${figure(150,210,.9,'#987391')}<path d="M120 358Q111 319 77 333Q46 344 59 375Q77 402 105 381L201 392L209 407H74" fill="#ac895b"/>${circle(89,349,25,'fill="#b38c59"')}${circle(89,349,15,'fill="#d1b080"')}<path d="M77 348L82 344M96 344L101 348M85 357L89 361L94 357M92 329L101 321M79 328L71 319M119 308L95 332M179 308L105 349"/>${star(150,148,8)}`;
    case 9: return `${hill}${figure(151,200,1.03,'#6d6c87')}<path d="M189 241L226 236M226 213V402M101 252L74 215"/><path d="M59 166H88V210H59ZM65 158H82V166" fill="#b6965a"/>${star(74,187,12,pale)}${circle(74,187,34,'fill="url(#glow)" stroke="none"')}<path d="M119 411L176 410"/>`;
    case 10: return `${halo(150,265,101)}${circle(150,265,77,'fill="#4a3b65"')}${circle(150,265,49)}${rays(150,265,15,76,8)}${circle(150,265,15,'fill="#b69b69"')}<path d="M121 197L137 201L133 217M203 236L190 247L204 255M175 321L160 326L168 341M95 294L108 283L96 276"/>${star(65,147,14)}${star(235,147,14)}${star(65,390,14)}${star(235,390,14)}`;
    case 11: return `${figure(150,215,.95,'#85678e')}${crown(150,172,.5)}<path d="M64 151H91V414H64ZM210 151H237V414H210Z" fill="#5f566d"/>${scales(92,285,.5)}<g transform="translate(209 279) scale(.86)">${sword}</g><path d="M139 213L151 229L162 213"/>`;
    case 12: return `<path d="M72 143H233M89 143V406M65 413H113M89 170L132 148M89 202L112 178" stroke-width="5"/>${branch(228,282,-1)}<g transform="rotate(180 157 290)">${figure(157,207,.72,'#7c6d9a')}</g>${circle(157,363,32)}<path d="M143 170L179 203L172 243M178 202L137 235M145 270L184 291L203 269"/>${star(157,362,9)}`;
    case 13: return `<path d="M47 419V218A103 103 0 0 1 253 218V419" fill="#26243d"/><path d="M64 419V220A86 86 0 0 1 236 220V419"/>${circle(150,338,48,'fill="#b69a6d" stroke="none"')}<path d="M63 386Q150 345 237 386L239 421H61Z" fill="#584d66"/>${figure(144,223,.83,'#44384e')}<path d="M175 211Q218 213 231 254M203 214L195 380"/><path d="M129 210L154 208L162 231L152 253H128L120 230Z" fill="#d5c7b3"/><path d="M130 225L137 232M146 232L153 225M137 245H148"/>${star(86,157,8)}`;
    case 14: return `${halo(150,183,50)}<path d="M122 242Q61 179 47 249Q52 294 105 310M178 242Q239 179 253 249Q248 294 195 310" fill="#6f7993"/>${figure(150,212,.91,'#817797')}${vessel(105,290,.68)}${vessel(195,324,.68)}<path d="M113 290Q159 310 188 324M111 296Q158 316 189 330" stroke="${cyan}"/><path d="M107 406Q146 385 187 412M110 417Q156 398 199 422" stroke="${cyan}" opacity=".7"/>`;
    case 15: return `${circle(150,230,75,'fill="#47334d"')}${figure(150,224,.92,'#6c455f')}<path d="M128 200Q107 170 109 147Q138 158 141 183M159 183Q162 158 191 147Q193 170 172 200" fill="#9b7e72"/><path d="M100 257L64 216L61 285L112 303M200 257L236 216L239 285L188 303" fill="#513b68"/>${circle(96,361,18)}${circle(204,361,18)}<path d="M112 368Q150 421 188 368M88 377V410M212 377V410" stroke-dasharray="5 5"/>${star(150,163,17)}`;
    case 16: return `<path d="M102 402L113 196H193L204 402Z" fill="#786679"/><path d="M116 223H190M110 283H196M107 343H199M140 195V225M169 225V281M137 284V341M168 342V401" opacity=".6"/><path d="M143 248H169V279H143ZM141 357H171V403H141Z" fill="#1b1930"/><path d="M190 102L157 155L180 153L141 211L151 165L130 171Z" fill="${pale}"/><path d="M111 190L96 162L117 153L138 167L159 144L186 163L182 185Z" fill="#b69b69"/><path d="M90 224L68 277L82 294M215 246L240 294L224 311M79 323L59 367M224 339L246 380"/>${star(64,203,9)}${star(231,214,10)}${star(63,304,8)}`;
    case 17: return `${star(150,180,39)}${[[-74,5],[-52,-48],[54,-47],[77,12],[-52,66],[55,67]].map(([x,y])=>star(150+x,180+y,8)).join('')}${figure(150,277,.64,'#a092b5')}${vessel(101,334,.7)}${vessel(201,334,.7)}<path d="M101 335Q85 375 59 393M201 336Q217 378 241 388M36 408Q78 388 119 408T203 408T269 410" stroke="${cyan}"/><path d="M56 419Q122 402 171 420T252 421" opacity=".6"/>`;
    case 18: return `${moon(150,176,48)}${circle(150,176,62)}${star(73,137,7)}${star(227,137,7)}<path d="M43 274L52 254H85L94 274V402H43ZM207 274L216 254H249L258 274V402H207Z" fill="#675b7a"/><path d="M58 293H78V319H58ZM222 293H242V319H222Z" fill="#191a30"/><path d="M119 422Q93 387 141 350Q188 307 148 263M161 422Q134 390 167 362Q208 323 163 266" fill="#3d5368"/><path d="M83 376L104 347L116 373M193 375L209 347L220 376"/><path d="M145 408L138 394L150 383L163 396L158 411" stroke="${cyan}"/>`;
    case 19: return `${circle(150,197,57,'fill="#b69b69"')}${circle(150,197,50)}${rays(150,197,67,91,20)}<path d="M128 188Q135 181 142 188M158 188Q165 181 172 188M150 191L145 208H155M136 219Q150 229 164 219"/><path d="M32 361Q92 323 153 361T270 361V421H32Z" fill="#53636b"/>${figure(150,316,.48,'#a78389')}<path d="M94 383Q105 353 131 371L185 373L204 400H100Z" fill="#d0c5b7"/>${branch(47,421)}${branch(253,421,-1)}`;
    case 20: return `${halo(150,176,63)}<path d="M139 158L190 171L190 186L139 196ZM123 156H139V197H123Z" fill="#b4976b"/><path d="M190 170L216 157V201L190 187Z" fill="#ac8d61"/><path d="M83 150Q42 178 68 218L112 199M85 206L109 235M216 220L207 237"/><path d="M83 259L101 310M150 252V307M217 259L199 310" stroke-dasharray="4 6"/>${figure(81,331,.44,'#77758c')}${figure(150,321,.5,'#8e799b')}${figure(219,331,.44,'#77758c')}<path d="M47 411H253M60 422H240" stroke="${cyan}"/>`;
    case 21: return `<g transform="translate(150 263)"><ellipse rx="84" ry="134" fill="#2c2c48"/><ellipse rx="76" ry="126"/>${Array.from({length:20},(_,n)=>{const a=n/20*Math.PI*2;return `<ellipse cx="${Math.cos(a)*82}" cy="${Math.sin(a)*133}" rx="6" ry="14" transform="rotate(${-a*180/Math.PI} ${Math.cos(a)*82} ${Math.sin(a)*133})" fill="#748786" stroke-width=".8"/>`;}).join('')}</g>${figure(150,221,.83,'#8d70a2')}<path d="M117 269L91 298M183 269L209 243M128 335L173 371M173 371L139 400"/>${star(52,132,16)}${star(248,132,16)}${star(52,404,16)}${star(248,404,16)}`;
    default: return '';
  }
}

function frame(label, art, theme=gold, subtitle='MAJOR ARCANA') {
  const stars = Array.from({length:22}, (_,n)=>star(37+(n*53)%226,88+(n*79)%321,1.1+(n%3)*.65, n%4?gold:cyan)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="500" viewBox="0 0 300 500" role="img" aria-label="Original symbolic tarot illustration"><defs><linearGradient id="bg" x2=".8" y2="1"><stop stop-color="#27223f"/><stop offset=".53" stop-color="#17152e"/><stop offset="1" stop-color="#302440"/></linearGradient><radialGradient id="glow"><stop stop-color="#eed69d" stop-opacity=".4"/><stop offset="1" stop-color="#eed69d" stop-opacity="0"/></radialGradient></defs><rect x="1" y="1" width="298" height="498" rx="18" fill="#111023" stroke="${theme}" stroke-width="2"/><rect x="10" y="10" width="280" height="480" rx="13" fill="url(#bg)" stroke="${theme}" stroke-width=".8"/><rect x="19" y="19" width="262" height="462" rx="9" fill="none" stroke="${theme}" opacity=".45"/><path d="M19 67H281M19 438H281M27 74V429M273 74V429" stroke="${theme}" fill="none" opacity=".4"/><g opacity=".55">${stars}</g><g fill="none" stroke="${theme}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${art}</g><path d="M31 52H107M193 52H269" stroke="${theme}" opacity=".65"/><text x="150" y="53" text-anchor="middle" font-family="Georgia,serif" font-size="20" fill="${pale}" letter-spacing="3">${label}</text><text x="150" y="460" text-anchor="middle" font-family="Georgia,serif" font-size="9" fill="${theme}" letter-spacing="2.5">${subtitle}</text>${star(150,477,4)}${star(28,28,5)}${star(272,28,5)}${star(28,472,5)}${star(272,472,5)}</svg>`;
}

for (let i=0;i<names.length;i++) writeFileSync(path.join(out,`${names[i]}.svg`),frame(roman[i],majorArt(i)));

function minorArt(suit, rank) {
  const motif=motifs[suit];
  const color={wands:'#d0a178',cups:'#a7bdd2',swords:'#9dc3cf',pentacles:'#c9b57d'}[suit];
  const body=`<g stroke="${color}">${halo(150,253,95)}<path d="M58 390Q150 363 242 390M54 403Q150 375 246 403" opacity=".35"/>`;
  if(rank===1) return body+`<g transform="translate(150 261) scale(1.76)">${motif}</g>${star(90,160,10)}${star(210,160,10)}${star(150,368,8)}</g>`;
  if(rank>=11) {
    const hue={wands:'#926783',cups:'#667d9e',swords:'#657e90',pentacles:'#7c7c68'}[suit];
    const y=rank===11?223:rank===12?211:210;
    const cape=rank===11?.86:rank===12?.95:1;
    const court=rank===11?'PAGE':rank===12?'KNIGHT':rank===13?'QUEEN':'KING';
    let extra = rank===11?`<path d="M129 197L135 171L172 181L169 194" fill="${hue}"/>`:rank===12?`<path d="M126 195L123 168L151 154L174 168L173 194L151 182Z" fill="#9194a2"/><path d="M127 175H172M140 157L148 144L164 155"/>`:crown(150,173,.6);
    if(rank>=13)extra+=`<path d="M79 217V412H221V217L207 202H93Z" fill="none"/><path d="M79 320H98M202 320H221"/>`;
    return body+`${figure(150,y,cape,hue)}${extra}<g transform="translate(${rank===12?91:207} ${rank===12?295:290}) scale(.66)">${motif}</g>${rank===12?'<path d="M84 395Q72 367 46 381L39 405H95L111 418H219" fill="#a59aa5"/>':''}<text x="150" y="420" fill="${pale}" stroke="none" text-anchor="middle" font-size="11" font-family="Georgia,serif" letter-spacing="4">${court}</text></g>`;
  }
  const positions={
    2:[[150,188],[150,329]],
    3:[[102,194],[198,194],[150,337]],
    4:[[101,189],[199,189],[101,338],[199,338]],
    5:[[93,182],[207,182],[150,264],[93,347],[207,347]],
    6:[[97,172],[203,172],[97,265],[203,265],[97,358],[203,358]],
    7:[[88,173],[212,173],[88,265],[212,265],[88,357],[212,357],[150,218]],
    8:[[86,171],[214,171],[86,264],[214,264],[86,357],[214,357],[150,215],[150,312]],
    9:[[84,171],[216,171],[84,264],[216,264],[84,357],[216,357],[150,172],[150,264],[150,357]],
    10:[[86,151],[214,151],[86,227],[214,227],[86,303],[214,303],[86,379],[214,379],[150,190],[150,340]],
  }[rank];
  const size=suit==='pentacles'?.74:suit==='cups'?.67:.63;
  return body+`${positions.map(([x,y],j)=>`<g transform="translate(${x} ${y}) ${suit==='swords'&&j%2?'rotate(180) ':''}scale(${size})">${motif}</g>`).join('')}${rank>=5?eye(150,265,.3):star(150,265,8)}</g>`;
}

for (const suit of ['wands','cups','swords','pentacles']) for(let rank=1;rank<=14;rank++) {
  const label=rank===1?'ACE':rank===11?'PAGE':rank===12?'KNIGHT':rank===13?'QUEEN':rank===14?'KING':roman[rank];
  writeFileSync(path.join(out,`${suit}-${rank}.svg`),frame(label,minorArt(suit,rank),suit==='cups'||suit==='swords'?cyan:gold,suit.toUpperCase()));
}

const back = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="500" viewBox="0 0 300 500"><defs><linearGradient id="back" x2="1" y2="1"><stop stop-color="#35254d"/><stop offset=".5" stop-color="#191830"/><stop offset="1" stop-color="#3e2a51"/></linearGradient><pattern id="stars" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M20 16V24M16 20H24" stroke="#b7a0c5" stroke-width=".5" opacity=".35"/></pattern></defs><rect x="1" y="1" width="298" height="498" rx="18" fill="url(#back)" stroke="${gold}" stroke-width="2"/><rect x="12" y="12" width="276" height="476" rx="12" fill="url(#stars)" stroke="${gold}" stroke-width=".8"/><rect x="23" y="23" width="254" height="454" rx="8" fill="none" stroke="${gold}" opacity=".55"/><g stroke="${gold}" fill="none" stroke-width="1"><path d="M150 53L254 250L150 447L46 250Z"/><path d="M150 80L239 250L150 420L61 250Z" opacity=".5"/>${circle(150,250,76)}${circle(150,250,66)}${rays(150,250,83,95,24)}${eye(150,250,1.03)}${moon(150,123,17)}${moon(150,377,17)}<path d="M34 82H63V53M266 82H237V53M34 418H63V447M266 418H237V447"/></g>${star(150,60,7)}${star(150,440,7)}${star(48,250,7)}${star(252,250,7)}${star(53,53,5)}${star(247,53,5)}${star(53,447,5)}${star(247,447,5)}</svg>`;
writeFileSync(path.join(root,'public','assets','card-back.svg'),back);

const avatarOut=path.join(root,'public','assets','avatars'); mkdirSync(avatarOut,{recursive:true});
const avatarColors=['#b68cc9','#76b7bd','#d5a4b2','#829ec6','#c6a56f','#b59cd0','#91ac9b','#c08a9b','#7ea5bc','#c8b096'];
for(let n=0;n<10;n++) {
  const color=avatarColors[n], hair=n%3===0?'#211c32':n%3===1?'#473348':'#584532';
  const silhouette=n%2===0?`<path d="M24 60Q16 22 48 18Q80 23 72 62L63 76H33Z" fill="${hair}"/>`:`<path d="M25 41Q22 15 50 17Q77 20 73 45L64 52H34Z" fill="${hair}"/>`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="${color}"/><stop offset="1" stop-color="#30263f"/></linearGradient><clipPath id="c"><circle cx="48" cy="48" r="47"/></clipPath></defs><circle cx="48" cy="48" r="47" fill="url(#a)"/><g clip-path="url(#c)"><circle cx="72" cy="23" r="21" fill="white" opacity=".08"/>${silhouette}<path d="M13 97Q17 70 37 69H59Q79 70 83 97" fill="${n%2?'#46586d':'#665078'}"/><path d="M39 62H57V74L48 81L39 74Z" fill="#c49e91"/><ellipse cx="48" cy="46" rx="20" ry="25" fill="#d6b0a0"/><path d="M27 42Q25 21 49 20Q73 23 70 42L58 34Q44 38 37 31L29 47Z" fill="${hair}"/><path d="M38 47L42 47M55 47L59 47M44 59Q48 62 52 59" fill="none" stroke="#6c4650" stroke-width="1.6" stroke-linecap="round"/></g><circle cx="48" cy="48" r="46" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
  writeFileSync(path.join(avatarOut,`avatar-${n}.svg`),svg);
}
writeFileSync(path.join(avatarOut,'community.svg'),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="46" fill="#41325e" stroke="${gold}" stroke-width="2"/><g fill="none" stroke="${gold}" stroke-width="2">${circle(48,48,28)}${rays(48,48,33,38,12)}${eye(48,48,.55)}</g>${star(48,16,5)}</svg>`);
console.log('Created 78 card illustrations, card back, and 11 demo avatars.');
