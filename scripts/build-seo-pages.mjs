// Builds the search pages from the game's own questions: past-puzzles.html, number-trivia-questions.html,
// estimation-game.html and sitemap.xml. Run: node scripts/build-seo-pages.mjs
// Only questions from puzzles that have already finished are ever published, so nothing spoils today's puzzle.
import { writeFileSync } from 'node:fs';
import { loadGame } from './load-game.mjs';

const G = loadGame();
const SITE = 'https://playdialin.com';
const today = G.DateUK.today();
const todayNo = G.DateUK.puzzleNo(today);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const ans = q => { const n = G.fmtAns(q, q.answer); const u = q.unit === 'year' ? '' : q.unit; return !u ? n : /^[%°]/.test(u) ? n + u : `${n} ${u}`; };
const dateOf = no => { const d = new Date(G.CONFIG.EPOCH + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + no - 1); return d.toISOString().slice(0, 10); };
const pretty = iso => G.DateUK.pretty(iso);
const puzzle = no => G.dailyIds(dateOf(no)).map(id => G.BY_ID.get(id));

const crumbs = (name, path) => ({ '@context':'https://schema.org', '@type':'BreadcrumbList', itemListElement:[
  { '@type':'ListItem', position:1, name:'DIAL IN', item: SITE + '/' }, { '@type':'ListItem', position:2, name, item: SITE + path }] });

function page({ path, title, description, h1, lede, body, ld = [] }) {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#150b33">
<meta name="color-scheme" content="dark">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}${path}">
<link rel="icon" type="image/svg+xml" href="icons/favicon.svg">
<meta property="og:type" content="article">
<meta property="og:site_name" content="DIAL IN">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/icons/og-image.png">
<meta property="og:url" content="${SITE}${path}">
<meta name="twitter:card" content="summary_large_image">
${[crumbs(h1, path), ...ld].map(o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n')}
<style>
@font-face{font-family:'Rubik';font-style:normal;font-weight:500 900;font-display:swap;src:url(fonts/rubik-latin.woff2) format('woff2')}
@font-face{font-family:'Bungee';font-style:normal;font-weight:400;font-display:swap;src:url(fonts/bungee-latin.woff2) format('woff2')}
:root{--bg:#150b33;--surface:#251856;--inset:#0f0828;--text:#fff6e5;--text-2:#c6bbec;--gold:#ffd23f;--link:#4de1ff;--pink:#ff3d7f}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:500 16px/1.6 'Rubik',system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding-block:24px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.logo{font:400 22px 'Bungee',system-ui,sans-serif;color:var(--text);text-decoration:none}
.logo b{color:var(--pink);font-weight:400}
h1{font:400 28px/1.2 'Bungee',system-ui,sans-serif;color:var(--gold);margin:28px 0 6px;text-wrap:balance}
h2{font:800 21px/1.3 'Rubik',system-ui,sans-serif;color:var(--gold);margin:36px 0 8px;text-wrap:balance}
h3{font:800 17px/1.3 'Rubik',system-ui,sans-serif;margin:0}
p,li{max-width:68ch}
.lede{font-size:18px}
.muted{color:var(--text-2);font-size:14px}
a{color:var(--link)}
a.btn{display:inline-block;background:var(--gold);color:#150b33;font-weight:800;text-decoration:none;padding:10px 16px;border-radius:10px}
a:focus-visible,summary:focus-visible{outline:3px solid var(--link);outline-offset:2px}
.cta{background:var(--surface);border:2px solid var(--gold);border-radius:14px;padding:16px 18px;margin:24px 0;text-align:center}
.cta p{margin:0 auto 10px}
ol.qs{list-style:none;padding:0;margin:12px 0;counter-reset:q}
ol.qs>li{background:var(--inset);border-radius:12px;padding:12px 14px;margin:8px 0;counter-increment:q}
ol.qs>li::before{content:counter(q);float:left;font:400 14px/1.6 'Bungee',system-ui,sans-serif;color:var(--text-2);width:30px}
.q{font-weight:700;margin:0 0 4px 30px}
.cat{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--text-2);margin-left:30px}
details{margin:6px 0 0 30px}
summary{cursor:pointer;color:var(--link);font-weight:700}
.a{margin:6px 0 0}
.a b{color:var(--gold)}
.pz{background:var(--surface);border-radius:14px;padding:14px 16px;margin:16px 0}
.pz h2{margin:0 0 4px;font-size:19px}
.nav{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:32px}
</style>
</head>
<body>
<main>
  <div class="top">
    <a class="logo" href="./">DIAL <b>IN</b></a>
    <a class="btn" href="./">Play today’s puzzle</a>
  </div>
  <h1>${esc(h1)}</h1>
  <p class="lede">${lede}</p>
${body}
  <nav class="nav muted" aria-label="More from DIAL IN"><a href="./">Play DIAL IN</a><a href="how-to-play">How to play</a><a href="past-puzzles">Past puzzles</a><a href="number-trivia-questions">Number trivia questions</a><a href="estimation-game">Estimation game</a><a href="terms">Terms</a><a href="privacy">Privacy</a></nav>
</main>
</body>
</html>
`;
}

const cta = (line = 'Think you can get closer? Seven new number questions every day, free.') =>
  `  <div class="cta"><p>${line}</p><a class="btn" href="./">Play DIAL IN now</a></div>\n`;
const qItem = (q, open = false) => `    <li><p class="q">${esc(q.question)}</p><span class="cat">${esc(q.category)}</span>
      <details${open ? ' open' : ''}><summary>Show the answer</summary><p class="a"><b>${esc(ans(q))}</b>. ${esc(q.explanation)}</p></details></li>`;
const qaLD = (qs, name) => ({ '@context':'https://schema.org', '@type':'Quiz', name, about:'Number trivia', educationalLevel:'general',
  hasPart: qs.map(q => ({ '@type':'Question', name:q.question, eduQuestionType:'Flashcard', acceptedAnswer:{ '@type':'Answer', text:`${ans(q)}. ${q.explanation}` } })) });

// ---- Past puzzles: every finished daily puzzle, newest first
const past = [];
for (let no = todayNo - 1; no >= 1; no--) past.push(no);
const pastBody = past.length ? past.map(no => `  <section class="pz" id="puzzle-${no}">
    <h2>DIAL IN #${no} · ${esc(pretty(dateOf(no)))}</h2>
    <ol class="qs">
${puzzle(no).map(q => qItem(q)).join('\n')}
    </ol>
  </section>`).join('\n') : '  <p>The first puzzle is still running. Check back tomorrow.</p>';
writeFileSync('past-puzzles.html', page({
  path:'/past-puzzles',
  title:'DIAL IN Answers – Past Daily Puzzles and Solutions',
  description:`Answers to every past DIAL IN daily puzzle${past.length ? `, up to #${past[0]}` : ''}: all seven number trivia questions with the right answers and explanations.`,
  h1:'Past puzzles and answers',
  lede:`Missed a day, or want to check an answer? Here’s every finished DIAL IN puzzle with the answers. Today’s puzzle (#${todayNo}) stays hidden until it ends at midnight UK time, so go and play it first.`,
  body: cta('Today’s seven questions are waiting. Can you dial in?') + pastBody + '\n' + cta()
}));

// ---- Number trivia questions: a fixed set from the earliest puzzles, grouped by category
const pool = []; for (let no = 1; no <= Math.min(10, todayNo - 1); no++) pool.push(...puzzle(no));
const byCat = new Map(); for (const q of pool.slice(0, 60)) { if (!byCat.has(q.category)) byCat.set(q.category, []); byCat.get(q.category).push(q); }
const cats = [...byCat.entries()].sort((a, b) => b[1].length - a[1].length);
const triviaQs = cats.flatMap(([, qs]) => qs);
writeFileSync('number-trivia-questions.html', page({
  path:'/number-trivia-questions',
  title:`${triviaQs.length} Number Trivia Questions and Answers – DIAL IN`,
  description:`${triviaQs.length} number trivia questions with answers: years, distances, records and counts across history, science, sport, geography and more. Great for quizzes.`,
  h1:`${triviaQs.length} number trivia questions (with answers)`,
  lede:'Every answer is a number. Use them for a pub quiz, a family game or a classroom warm-up: read the question, let everyone write down a guess, and whoever is closest wins the point. Tap a question to reveal its answer.',
  ld:[qaLD(triviaQs, 'Number trivia questions')],
  body: cta('Want seven fresh ones every day, scored automatically?') + cats.map(([cat, qs]) => `  <h2>${esc(cat)} questions</h2>
  <ol class="qs">
${qs.map(q => qItem(q)).join('\n')}
  </ol>`).join('\n') + `
  <h2>How to run a closest-number quiz</h2>
  <ul>
    <li>Everyone writes down a number for each question. No multiple choice, so nobody can guess at random.</li>
    <li>Closest answer wins the round. For a fairer score, give points by how close people are: within 10% scores well, spot on scores best.</li>
    <li>For years, count how many years off each guess is.</li>
    <li>Short of questions? DIAL IN has over 1,300, and the Battle mode runs the quiz for you on everyone’s phones.</li>
  </ul>
` + cta()
}));

// ---- Estimation game: what it is, why it's fun, sample questions
const samples = []; for (let no = 11; no <= Math.min(13, todayNo - 1); no++) samples.push(...puzzle(no));
const sampleQs = samples.filter(q => q.scoring !== 'abs').slice(0, 10);
writeFileSync('estimation-game.html', page({
  path:'/estimation-game',
  title:'Estimation Game Online – Guess the Number Quiz | DIAL IN',
  description:'Play a free online estimation game: guess the number for seven real-world questions a day, see how close you got on the dial, and compare with friends.',
  h1:'The daily estimation game',
  lede:'How tall is the Eiffel Tower? How many bones are in the human body? DIAL IN is a free guess-the-number game: every question has a number for an answer, and the closer your estimate, the more points you score.',
  ld:[qaLD(sampleQs, 'Estimation game sample questions')],
  body: cta('Seven new questions every day. Free, no download.') + `
  <h2>How the estimation game works</h2>
  <ul>
    <li>Seven questions a day, the same for everyone. A new set starts at midnight UK time.</li>
    <li>Type your best guess. You don’t need to know the answer, just get close.</li>
    <li>The dial shows how far off you were. Spot on scores 1,000 points, within 1% scores 900, within 10% scores 600, and so on.</li>
    <li>Finish to unlock Dial Ball, a pinball bonus round, then see how many players you beat.</li>
  </ul>
  <h2>Try some estimation questions</h2>
  <p>Make a guess for each one before you reveal the answer. Within 10% is a great estimate.</p>
  <ol class="qs">
${sampleQs.map(q => qItem(q)).join('\n')}
  </ol>
  <h2>Tips for better estimates</h2>
  <ul>
    <li><b>Anchor on something you know.</b> A double-decker bus is about 11 metres long, a football pitch about 100 metres, Mount Everest 8,849 metres high.</li>
    <li><b>Break it down.</b> Estimate a smaller piece you’re sure of, then multiply up. This is how scientists make “Fermi estimates”.</li>
    <li><b>Think in orders of magnitude.</b> Is it closer to 100, 1,000 or 10,000? Getting the size right earns most of the points.</li>
    <li><b>For years, use landmarks.</b> What else was happening at the time? Within three years still scores well.</li>
  </ul>
  <h2>Why estimation games are good for you</h2>
  <p>Estimating builds number sense: the feel for how big things are that helps with everything from budgeting to spotting a dodgy statistic. It’s also a great leveller. Nobody knows every answer, so a good guess can beat a know-it-all, which makes it ideal for families, classrooms and friendly rivalries.</p>
` + cta()
}));

// ---- Sitemap
const urls = [['/', 'daily'], ['/how-to-play', 'monthly'], ['/past-puzzles', 'daily'], ['/number-trivia-questions', 'monthly'], ['/estimation-game', 'monthly'], ['/terms', 'yearly'], ['/privacy', 'yearly']];
writeFileSync('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, f]) => `  <url><loc>${SITE}${u}</loc>${u === '/past-puzzles' || u === '/' ? `<lastmod>${today}</lastmod>` : ''}<changefreq>${f}</changefreq></url>`).join('\n')}
</urlset>
`);
console.log(`Built pages for ${today} (puzzle #${todayNo}): ${past.length} past puzzles, ${triviaQs.length} trivia questions, ${sampleQs.length} estimation samples.`);
