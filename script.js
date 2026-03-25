/* ═══════════════════════════════════════════════════════════
   POKÉMON TYPE ANALYSIS — script.js
═══════════════════════════════════════════════════════════ */

// ── CONFIG ───────────────────────────────────────────────
const SHEET_ID = '2PACX-1vRLw663qZG5V_s_N-KRVLjWzst-z88O6PTcBQ_IPRdd2WOJLq66V3UvfPmiTpwD5inmIdkMBQCHN9o4';

// !! IMPORTANT: Replace POKEMON_GID with the gid number from your Pokemon tab URL
// Click your Pokemon data tab in Google Sheets, look at the URL: ...#gid=XXXXXXXX
const POKEMON_GID = '552287976';

const POKEMON_CSV_URLS = [
  `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pub?gid=${POKEMON_GID}&single=true&output=csv`,
  `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pub?gid=${POKEMON_GID}&output=csv`,
];
const DPS_CSV_URL = `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pub?gid=1576879827&single=true&output=csv`;

const COLS = {
  name: 'pokemon_name', type1: 'type1', type2: 'type2',
  attack: 'base_attack', defense: 'base_defense', stamina: 'base_stamina',
};

const TYPE_COLORS = {
  bug:'#78c850', grass:'#4caf50', fire:'#f08030', water:'#6890f0',
  electric:'#f8d030', psychic:'#f85888', ice:'#98d8d8', dragon:'#7038f8',
  dark:'#8B7355', fairy:'#ee99ac', normal:'#a8a878', fighting:'#c03028',
  flying:'#a890f0', poison:'#a040a0', ground:'#e0c068', rock:'#b8a038',
  ghost:'#705898', steel:'#b8b8d0', default:'#5a6b5a',
};
const BUG_COLOR = '#78c850';

const DPS_TYPE_ORDER  = ['bug','fire','dark','ghost','fairy','fighting','poison','ice','flying','grass'];
const SUPER_EFFECTIVE = {
  grass:   ['bug','fire','flying','ice','poison'],
  dark:    ['bug','fairy','fighting'],
  psychic: ['bug','dark','ghost'],
};

// ── STATE ────────────────────────────────────────────────
let allPokemon = [], typeStats = {}, headers = [];
let statCols   = ['base_attack','base_defense','base_stamina'];
let dpsData    = { grass:[], dark:[], psychic:[] };
let scatterHighlightType = 'bug';
let scatterBugHighlightOn = true;

// Render state — tracks what data is ready and what has been built
const ready   = { pokemon: false, dps: false };
const built   = { ch1: false, ch2: false, ch3: false, ch5: false, ch6: false };
// Track which chapters the scroll observer has seen
const seen    = { ch1: false, ch2: false, ch3: false, ch4: false, ch5: false, ch6: false };

// Called whenever data arrives OR scroll fires — renders if both are ready
function tryRender(ch) {
  if (ch === 'ch1' && ready.pokemon && seen.ch1 && !built.ch1) {
    built.ch1 = true;
    animateBars();
  }
  if (ch === 'ch2' && ready.pokemon && seen.ch2 && !built.ch2) {
    built.ch2 = true;
    buildScatter();
  }
  if (ch === 'ch3' && ready.pokemon && seen.ch3 && !built.ch3) {
    built.ch3 = true;
    initPieParticles();
    buildRadial();
  }
  if (ch === 'ch5' && ready.dps && ready.pokemon && seen.ch5 && !built.ch5) {
    built.ch5 = true;
    buildDpsChart();
  }
  if (ch === 'ch6' && seen.ch6 && !built.ch6) {
    built.ch6 = true;
    buildRaidsChart();
  }
}

// Eagerly compute verdict stats so tiles populate without scrolling
function updateVerdictStats() {
  // vstat1: Bug rank (already set by renderBarChart, but ensure it runs)
  if (ready.pokemon && Object.keys(typeStats).length) {
    const sorted = Object.entries(typeStats).sort((a,b) => b[1].overallAvg - a[1].overallAvg);
    const nTypes = sorted.length;
    const bugRank = sorted.findIndex(([t]) => t === 'bug');
    const v1 = document.getElementById('vstat1');
    if (v1) v1.textContent = bugRank >= 0 ? `#${bugRank+1} / ${nTypes}` : '—';
  }

  // vstat2: Attack/Defense delta
  if (ready.pokemon && allPokemon.length) {
    const xCol = statCols.includes(COLS.attack) ? COLS.attack : statCols[0];
    const yCol = statCols.includes(COLS.defense) ? COLS.defense : (statCols[1]||statCols[0]);
    const t1Col = headers.includes(COLS.type1) ? COLS.type1 : (headers.find(h=>/type.?1/i.test(h))||'type1');
    const vals = allPokemon.map(p=>({
      x:parseFloat(p[xCol])||0, y:parseFloat(p[yCol])||0,
      t1:(p[t1Col]||'').toLowerCase().trim(),
    })).filter(v=>v.x>0&&v.y>0);
    const bugs = vals.filter(v=>v.t1==='bug');
    if (bugs.length && vals.length) {
      const bx = bugs.reduce((s,v)=>s+v.x,0)/bugs.length;
      const by = bugs.reduce((s,v)=>s+v.y,0)/bugs.length;
      const ax = vals.reduce((s,v)=>s+v.x,0)/vals.length;
      const ay = vals.reduce((s,v)=>s+v.y,0)/vals.length;
      const v2 = document.getElementById('vstat2');
      if (v2) {
        const atkDelta = Math.round(bx - ax);
        const defDelta = Math.round(by - ay);
        v2.textContent = `${atkDelta > 0 ? '+' : ''}${atkDelta} / ${defDelta > 0 ? '+' : ''}${defDelta}`;
      }
    }
  }

  // vstat3: Matchup pressure
  if (ready.pokemon && allPokemon.length && typeof TYPE_ATTACK_MATCHUPS !== 'undefined') {
    const t1Col = headers.includes(COLS.type1) ? COLS.type1 : (headers.find(h=>/type.?1/i.test(h))||'type1');
    const bugMatchup = TYPE_ATTACK_MATCHUPS['bug'] || { super: [], resist: [], immune: [] };
    const superSet = new Set(bugMatchup.super);
    const resistSet = new Set([...(bugMatchup.resist || []), ...(bugMatchup.immune || [])]);
    const typeCounts = {};
    allPokemon.forEach(p => {
      const t = (p[t1Col]||'').toLowerCase().trim();
      if (t) typeCounts[t] = (typeCounts[t]||0) + 1;
    });
    const superCount = Object.entries(typeCounts).filter(([t]) => superSet.has(t)).reduce((s,[,c])=>s+c,0);
    const resistCount = Object.entries(typeCounts).filter(([t]) => resistSet.has(t)).reduce((s,[,c])=>s+c,0);
    const v3 = document.getElementById('vstat3');
    if (v3) v3.textContent = `${superCount} / ${resistCount}`;
  }

  // vstat4: DPS leaderboard
  if (ready.dps && ready.pokemon && dpsData) {
    updateDpsVerdictStat();
  }

  // vstat5: Raid presence (needs RAIDS_DATA)
  if (typeof RAIDS_DATA !== 'undefined' && RAIDS_DATA.types['Bug']) {
    const bugData = RAIDS_DATA.types['Bug'];
    const allTypes = Object.values(RAIDS_DATA.types);
    const bugTotal = bugData.reduce((s, v) => s + v, 0);
    const avgTotal = Math.round(allTypes.reduce((s, vals) => s + vals.reduce((a,b)=>a+b,0), 0) / allTypes.length);
    const v5 = document.getElementById('vstat5');
    if (v5) v5.textContent = `${bugTotal}`;
    const v5b = document.getElementById('vstat5Breakdown');
    if (v5b) v5b.innerHTML = `Bug total raid appearances vs ${avgTotal} avg`;
  }
}

function onPokemonReady() {
  ready.pokemon = true;
  // Ensure STAB lookup map is rebuilt from real Pokémon rows.
  _pokemonTypeMap = null;
  buildTypeBarChart();
  updateVerdictStats();
  // Use setTimeout so the DOM from buildTypeBarChart is painted first
  setTimeout(() => {
    ['ch1','ch2','ch3','ch5'].forEach(tryRender);
  }, 50);
}

function onDpsReady() {
  ready.dps = true;
  updateVerdictStats();
  tryRender('ch5');
}

// ── CSV FETCH HELPER ─────────────────────────────────────
async function fetchOneURL(url) {
  // Manual timeout using Promise.race — avoids AbortSignal.timeout browser support issues
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), 9000)
  );
  const request = fetch(url, { mode: 'cors', cache: 'no-cache' })
    .then(async res => {
      const text = await res.text();
      // allorigins JSON wrapper
      try { const j = JSON.parse(text); if (j.contents) return j.contents; } catch(_) {}
      return text;
    });
  return Promise.race([request, timeout]);
}

function isValidCSV(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (t.startsWith('<')) return false;   // HTML error page
  if (t.length < 50)     return false;   // too short
  if (!t.includes(','))  return false;   // not CSV
  return true;
}

async function fetchCSV(url, isValid) {
  const proxies = [
    u => u,
    u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    u => `https://thingproxy.freeboard.io/fetch/${u}`,
  ];

  for (const mkp of proxies) {
    const proxyUrl = mkp(url);
    try {
      console.log('Trying:', proxyUrl.slice(0, 80));
      const text = await fetchOneURL(proxyUrl);
      const trimmed = (text || '').trim();

      if (!isValidCSV(trimmed)) {
        console.warn('  → invalid CSV (got:', trimmed.slice(0, 60), ')');
        continue;
      }
      if (isValid && !isValid(trimmed)) {
        console.warn('  → failed content validation');
        continue;
      }
      console.log('  → SUCCESS, length:', trimmed.length, 'rows:', trimmed.split('\n').length);
      return trimmed;
    } catch(e) {
      console.warn('  → error:', e.message);
    }
  }
  return null;
}

async function fetchCSVMulti(urls, isValid) {
  for (const url of urls) {
    const result = await fetchCSV(url, isValid);
    if (result) return result;
  }
  return null;
}

// ── LOAD POKÉMON DATA ────────────────────────────────────
async function loadData() {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  txt.textContent = 'Loading Pokémon data...';

  // Check for locally embedded data first (from data.js via convert-data.py)
  if (window.POKEMON_CSV_DATA) {
    console.log('✅ Using embedded local data (data.js)');
    txt.textContent = 'Using local data file';
    try {
      const rows = parseCSV(window.POKEMON_CSV_DATA);
      if (!rows.length) throw new Error('0 rows in embedded data');
      allPokemon = rows;
      headers    = Object.keys(rows[0]);
      const known = [COLS.attack, COLS.defense, COLS.stamina].filter(c => headers.includes(c));
      statCols   = known.length ? known : statCols;
      computeTypeStats();
      dot.className   = 'status-dot live';
      txt.textContent = `${rows.length} Pokémon loaded (local)`;
      onPokemonReady();
      return;
    } catch(e) {
      console.warn('Embedded data parse error:', e);
    }
  }

  // Validator: reject #ref! errors, wrong tabs, and insufficient rows
  const isPokemonSheet = text => {
    const firstLine = text.split('\n')[0].toLowerCase();
    const rowCount   = text.split('\n').filter(l => l.trim()).length;
    const hasError   = firstLine.includes('#ref') || firstLine.includes('#error') || firstLine.includes('#n/a');
    const hasRightCols = firstLine.includes('pokemon') || firstLine.includes('type1') || firstLine.includes('base_attack');
    const enoughRows   = rowCount > 50;
    console.log(`Sheet check: firstLine="${firstLine.slice(0,80)}" rows=${rowCount} hasError=${hasError} hasRightCols=${hasRightCols} enoughRows=${enoughRows}`);
    return !hasError && hasRightCols && enoughRows;
  };

  const csv = await fetchCSVMulti(POKEMON_CSV_URLS, isPokemonSheet);

  if (!csv) {
    // Show demo data so charts still render, but tell user what happened
    dot.className   = 'status-dot error';
    txt.textContent = 'Sheet unreachable — check F12 console for details. Showing demo data.';
    console.error('❌ All fetch attempts failed for:', POKEMON_CSV_URLS);
    console.error('Fix: In Google Sheets go to File → Share → Publish to web → CSV → Publish');
    usePokemonDemo();
    return;
  }

  try {
    const rows = parseCSV(csv);
    if (!rows.length) throw new Error('0 rows');

    allPokemon = rows;
    headers    = Object.keys(rows[0]);
    console.log(`Pokémon sheet: ${rows.length} rows, headers:`, headers);

    const known = [COLS.attack, COLS.defense, COLS.stamina].filter(c => headers.includes(c));
    statCols = known.length ? known : headers.filter(h => {
      if (['id','name','type','#','no'].some(p => h.toLowerCase().includes(p))) return false;
      return rows.slice(0,20).map(r => parseFloat(r[h])).filter(v => !isNaN(v)).length >= 5;
    });

    computeTypeStats();
    dot.className   = 'status-dot live';
    txt.textContent = `${rows.length} Pokémon loaded`;
    onPokemonReady();
  } catch(e) {
    console.error('Parse error:', e);
    dot.className   = 'status-dot error';
    txt.textContent = 'Parse error — using demo data';
    usePokemonDemo();
  }
}

// ── LOAD DPS DATA ────────────────────────────────────────
async function loadDpsData() {
  // Check for locally embedded DPS data first
  if (window.DPS_CSV_DATA) {
    console.log('✅ Using embedded local DPS data (data.js)');
    try {
      dpsData = parseDpsCSV(window.DPS_CSV_DATA);
      onDpsReady();
      return;
    } catch(e) {
      console.warn('Embedded DPS parse error:', e);
    }
  }

  const csv = await fetchCSV(DPS_CSV_URL);
  if (!csv) {
    console.warn('DPS sheet unreachable — using demo data');
    dpsData = buildDpsDemoData();
  } else {
    try {
      dpsData = parseDpsCSV(csv);
    } catch(e) {
      console.error('DPS parse error:', e);
      dpsData = buildDpsDemoData();
    }
  }
  onDpsReady();
}

// ── CSV PARSER ───────────────────────────────────────────
function parseCSV(csv) {
  csv = csv.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const lines = csv.trim().split('\n');
  function splitLine(line) {
    const out = []; let field = '', inQ = false;
    for (let i = 0; i <= line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if ((ch === ',' || ch === undefined) && !inQ) {
        out.push(field.trim()); field = '';
      } else { field += (ch || ''); }
    }
    return out;
  }
  const hdrs = splitLine(lines[0]).map(h => h.toLowerCase().trim());
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = splitLine(line);
    const obj  = {};
    hdrs.forEach((h,i) => { obj[h] = vals[i] !== undefined ? vals[i] : ''; });
    return obj;
  });
}

// ── DPS CSV PARSER ───────────────────────────────────────
// Wide format: row1 = type names, row2 = sub-headers, row3+ = data
// Each type group = 6 columns: Rank, Name, Fast_Move, Charged_Move, DPS, Base_Scale
function parseDpsCSV(csv) {
  csv = csv.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const lines = csv.trim().split('\n');
  if (lines.length < 3) return buildDpsDemoData();

  function splitLine(line) {
    const out = []; let field = '', inQ = false;
    for (let i = 0; i <= line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if ((ch === ',' || ch === undefined) && !inQ) {
        out.push(field.trim()); field = '';
      } else { field += (ch || ''); }
    }
    return out;
  }

  const typeRow = splitLine(lines[0]);
  console.log('DPS row0:', typeRow.slice(0, 20));

  // Typo correction map for common misspellings in the DPS sheet header
  const TYPO_MAP = {
    'figthing': 'fighting',
    'figting':  'fighting',
    'fightng':  'fighting',
    'poisin':   'poison',
    'psycic':   'psychic',
    'psycihc':  'psychic',
    'electrc':  'electric',
  };

  // Find column groups by locating type names in row 0 (with typo correction)
  const groups = [];
  typeRow.forEach((cell, i) => {
    let t = cell.trim().toLowerCase();
    if (TYPO_MAP[t]) {
      console.log(`DPS header typo corrected: "${cell}" → "${TYPO_MAP[t]}"`);
      t = TYPO_MAP[t];
    }
    if (DPS_TYPE_ORDER.includes(t)) groups.push({ type: t, start: i });
  });

  // Fallback: assume evenly spaced 6-col groups if header detection fails
  if (groups.length === 0) {
    DPS_TYPE_ORDER.forEach((t, gi) => groups.push({ type: t, start: gi * 6 }));
    console.warn('DPS type headers not detected — using fallback column positions');
  }
  console.log('DPS groups:', groups.map(g => `${g.type}@col${g.start}`).join(', '));

  const result = { grass:[], dark:[], psychic:[] };

  for (let li = 2; li < lines.length; li++) {
    const row = splitLine(lines[li]);
    if (!row.some(c => c.trim())) continue;

    groups.forEach(({ type, start }) => {
      const rankRaw = (row[start]     || '').trim();
      const name    = (row[start + 1] || '').trim();
      const rank    = parseInt(rankRaw);
      if (!name || isNaN(rank) || rank < 1) return;

      // DPS field may be "eDPS 26.66" or "26.66" — strip non-numeric prefix
      const dpsStr = (row[start + 4] || '').trim();
      const dps    = parseFloat(dpsStr.replace(/[^\d.]/g,'')) || 0;
      if (!dps) return;

      const entry = {
        type, rank, name,
        fastMove:    (row[start + 2] || '').trim(),
        chargedMove: (row[start + 3] || '').trim(),
        dps,
        scale: parseFloat((row[start + 5] || '').replace(/[^\d.]/g,'')) || 100,
      };

      Object.entries(SUPER_EFFECTIVE).forEach(([def, attackers]) => {
        if (attackers.includes(type)) result[def].push(entry);
      });
    });
  }

  // Sort by DPS — keep ALL entries so filters can pull from the full pool
  Object.keys(result).forEach(def => {
    result[def].sort((a,b) => b.dps - a.dps);
    console.log(`DPS ${def} (${result[def].length} total):`, result[def].slice(0,5).map(e => `${e.name}(${e.type}) ${e.dps}`));
  });

  return result;
}

// ── LEGENDARY SET ────────────────────────────────────────
// TRUE legendaries only — no mythicals (Mew, Celebi, Jirachi, etc.)
// Mythicals are event-only one-time Pokemon; legendaries are story/postgame encounters.
const LEGENDARY_NAMES = new Set([
  // Gen 1 — Legendary birds + Mewtwo (Mew excluded - mythical)
  'articuno','zapdos','moltres','mewtwo',
  // Gen 2 — Legendary beasts + tower duo (Celebi excluded - mythical)
  'raikou','entei','suicune','lugia','ho-oh',
  // Gen 3 — Regis, eon duo, weather trio (Jirachi, Deoxys excluded - mythical)
  'regirock','regice','registeel','latias','latios',
  'kyogre','groudon','rayquaza',
  // Gen 4 — Lake trio, creation trio, Heatran, Regigigas, Cresselia
  // (Phione, Manaphy, Darkrai, Shaymin, Arceus excluded - mythical)
  'uxie','mesprit','azelf','dialga','palkia','heatran',
  'regigigas','giratina','cresselia',
  // Gen 5 — Swords of Justice, forces of nature, Tao trio, Kyurem
  // (Victini, Keldeo, Meloetta, Genesect excluded - mythical)
  'cobalion','terrakion','virizion','tornadus',
  'thundurus','reshiram','zekrom','landorus','kyurem',
  // Gen 6 — Xerneas, Yveltal, Zygarde (Diancie, Hoopa, Volcanion excluded - mythical)
  'xerneas','yveltal','zygarde',
  // Gen 7 — Tapus, Cosmog line, Ultra Beasts, Necrozma
  // (Magearna, Marshadow, Poipole, Naganadel, Stakataka, Blacephalon, Zeraora excluded - mythical)
  'tapu koko','tapu lele','tapu bulu','tapu fini',
  'cosmog','cosmoem','solgaleo','lunala',
  'nihilego','buzzwole','pheromosa','xurkitree','celesteela','kartana','guzzlord',
  'necrozma',
  // Gen 8 — Zacian, Zamazenta, Eternatus, Kubfu, Urshifu, Regis, Spectrier, Glastrier, Calyrex, Enamorus
  // (Zarude excluded - mythical)
  'zacian','zamazenta','eternatus','kubfu','urshifu',
  'regieleki','regidrago','glastrier','spectrier','calyrex','enamorus',
  // Gen 9 — Treasures of Ruin, Paradox legends, box legendaries
  // (Okidogi, Munkidori, Fezandipiti, Ogerpon, Terapagos, Pecharunt excluded - mythical)
  'wo-chien','chien-pao','ting-lu','chi-yu',
  'koraidon','miraidon','walking wake','iron leaves',
]);

function isLegendary(pokemon) {
  const nameCol = headers.includes(COLS.name) ? COLS.name : 'pokemon_name';
  const name    = (pokemon[nameCol] || '').toLowerCase()
    .replace(/^(mega|shadow|alolan|galarian|hisuian|paldean) /, '')
    .replace(/\s*\(.*?\)/, '').trim();
  return LEGENDARY_NAMES.has(name);
}

// ── COMPUTE TYPE STATS ───────────────────────────────────
function computeTypeStats() {
  typeStats = {};
  const type1Col = headers.includes(COLS.type1) ? COLS.type1
    : headers.find(h => /type.?1/i.test(h)) || headers[2];
  const type2Col = headers.includes(COLS.type2) ? COLS.type2
    : headers.find(h => /type.?2/i.test(h)) || null;

  // Helper to add a pokemon to a type bucket (used for both type1 and type2)
  function addToType(type, p, isLeg, isPrimary) {
    if (!type) return;
    if (!typeStats[type]) typeStats[type] = {
      count: 0,           // total appearances (type1 + type2)
      primaryCount: 0,    // type1 only (used for stat averages)
      legendaryCount: 0,
      regularCount: 0,
      statSums: {}, legStatSums: {}, regStatSums: {},
    };
    const ts = typeStats[type];
    ts.count++;
    if (isPrimary) {
      ts.primaryCount++;
      if (isLeg) ts.legendaryCount++; else ts.regularCount++;
      // Only average stats from primary-type Pokémon to avoid double-counting
      statCols.forEach(col => {
        const v = parseFloat(p[col]);
        if (isNaN(v)) return;
        ts.statSums[col]    = (ts.statSums[col]    || 0) + v;
        if (isLeg) ts.legStatSums[col] = (ts.legStatSums[col] || 0) + v;
        else       ts.regStatSums[col] = (ts.regStatSums[col] || 0) + v;
      });
    }
  }

  allPokemon.forEach(p => {
    const t1    = (p[type1Col] || '').toLowerCase().trim();
    const t2    = type2Col ? (p[type2Col] || '').toLowerCase().trim() : '';
    const isLeg = isLegendary(p);
    addToType(t1, p, isLeg, true);
    if (t2 && t2 !== t1) addToType(t2, p, isLeg, false);
  });

  Object.keys(typeStats).forEach(type => {
    const ts = typeStats[type];
    const n  = ts.primaryCount || 1;
    const avgs = statCols.map(c => (ts.statSums[c]||0)/n).filter(v=>v>0);
    ts.overallAvg = avgs.length ? avgs.reduce((a,b)=>a+b,0)/avgs.length : 0;
    const legN = ts.legendaryCount || 1;
    const legAvgs = statCols.map(c => (ts.legStatSums[c]||0)/legN).filter(v=>v>0);
    ts.legendaryAvg = legAvgs.length ? legAvgs.reduce((a,b)=>a+b,0)/legAvgs.length : 0;
    const regN = ts.regularCount || 1;
    const regAvgs = statCols.map(c => (ts.regStatSums[c]||0)/regN).filter(v=>v>0);
    ts.regularAvg = regAvgs.length ? regAvgs.reduce((a,b)=>a+b,0)/regAvgs.length : 0;
  });
}

// ── DEMO DATA ────────────────────────────────────────────
function usePokemonDemo() {
  const types = ['Bug','Normal','Water','Fire','Grass','Psychic','Electric',
                 'Rock','Flying','Dragon','Dark','Fairy','Ghost','Steel',
                 'Ice','Ground','Poison','Fighting'];
  const base  = { Bug:95,Normal:115,Water:130,Fire:145,Grass:120,Psychic:150,
                  Electric:135,Rock:140,Flying:125,Dragon:165,Dark:138,Fairy:132,
                  Ghost:128,Steel:148,Ice:122,Ground:135,Poison:112,Fighting:142 };
  allPokemon = [];
  types.forEach(t => {
    for (let i=0; i<50; i++) {
      const b = base[t];
      allPokemon.push({
        pokemon_name: `${t}${i}`, type1: t.toLowerCase(),
        base_attack:  Math.round(b*(0.6+Math.random()*0.8)),
        base_defense: Math.round(b*(0.5+Math.random()*0.8)),
        base_stamina: Math.round(b*(0.7+Math.random()*0.6)),
      });
    }
  });
  headers  = ['pokemon_name','type1','base_attack','base_defense','base_stamina'];
  statCols = ['base_attack','base_defense','base_stamina'];
  computeTypeStats();
  onPokemonReady();
}

function buildDpsDemoData() {
  const mk = (type,name,fm,cm,dps) => ({type,rank:0,name,fastMove:fm,chargedMove:cm,dps,scale:(dps/22)*100});
  return {
    grass: [
      mk('fire','Mega Blaziken','Fire Spin','Blast Burn',30.60),
      mk('flying','Mega Rayquaza','Air Slash','Dragon Ascent',28.74),
      mk('ice','Kyurem (White)','Ice Fang','Ice Burn',27.06),
      mk('bug','Mega Heracross','Fury Cutter','Megahorn',26.66),
      mk('fire','Reshiram','Fire Fang','Overheat',25.10),
      mk('flying','Ho-Oh','Incinerate','Brave Bird',24.80),
      mk('poison','Mega Beedrill','Poison Jab','Sludge Bomb',24.50),
      mk('ice','Galarian Darmanitan','Ice Fang','Avalanche',24.20),
      mk('fire','Charizard Y','Fire Spin','Blast Burn',23.90),
      mk('flying','Yveltal','Gust','Oblivion Wing',23.60),
      mk('bug','Genesect','Fury Cutter','X-Scissor',22.80),
      mk('fire','Moltres','Fire Spin','Overheat',22.40),
      mk('ice','Mamoswine','Powder Snow','Avalanche',22.10),
      mk('poison','Roserade','Poison Jab','Sludge Bomb',21.80),
      mk('flying','Staraptor','Gust','Brave Bird',21.50),
      mk('ice','Weavile','Ice Shard','Avalanche',21.20),
      mk('fire','Flareon','Fire Spin','Overheat',20.90),
      mk('bug','Scizor','Fury Cutter','X-Scissor',20.60),
      mk('flying','Rayquaza','Air Slash','Aerial Ace',20.30),
      mk('poison','Tentacruel','Poison Jab','Sludge Wave',20.00),
    ],
    dark: [
      mk('fighting','Mega Lucario','Force Palm','Aura Sphere',32.33),
      mk('fairy','Mega Gardevoir','Charm','Dazzling Gleam',25.12),
      mk('bug','Mega Heracross','Fury Cutter','Megahorn',22.10),
      mk('fighting','Keldeo','Low Kick','Sacred Sword',21.80),
      mk('fairy','Xerneas','Geomancy','Moonblast',21.50),
      mk('fighting','Terrakion','Double Kick','Sacred Sword',21.10),
      mk('bug','Volcarona','Bug Bite','Bug Buzz',20.80),
      mk('fairy','Togekiss','Charm','Dazzling Gleam',20.50),
      mk('fighting','Conkeldurr','Counter','Dynamic Punch',20.20),
      mk('fairy','Sylveon','Charm','Moonblast',19.90),
      mk('bug','Genesect','Fury Cutter','X-Scissor',19.60),
      mk('fighting','Machamp','Counter','Dynamic Punch',19.30),
      mk('fairy','Clefable','Charm','Moonblast',19.00),
      mk('fighting','Breloom','Counter','Dynamic Punch',18.70),
      mk('bug','Pinsir','Bug Bite','X-Scissor',18.40),
      mk('fairy','Granbull','Charm','Play Rough',18.10),
      mk('fighting','Blaziken','Counter','Focus Blast',17.80),
      mk('fairy','Gardevoir','Charm','Dazzling Gleam',17.50),
      mk('bug','Scizor','Fury Cutter','X-Scissor',17.20),
      mk('fighting','Hariyama','Counter','Dynamic Punch',16.90),
    ],
    psychic: [
      mk('ghost','Necrozma (DW)','Psycho Cut','Moongeist Beam',29.13),
      mk('dark','Mega Tyranitar','Bite','Brutal Swing',27.21),
      mk('bug','Mega Heracross','Fury Cutter','Megahorn',21.50),
      mk('ghost','Giratina (Origin)','Shadow Claw','Shadow Ball',21.20),
      mk('dark','Darkrai','Snarl','Dark Pulse',20.90),
      mk('ghost','Mega Gengar','Lick','Shadow Ball',20.60),
      mk('bug','Vikavolt','Bug Bite','X-Scissor',19.80),
      mk('dark','Hydreigon','Bite','Brutal Swing',19.50),
      mk('ghost','Chandelure','Hex','Shadow Ball',19.20),
      mk('dark','Weavile','Snarl','Foul Play',18.90),
      mk('bug','Genesect','Fury Cutter','X-Scissor',18.60),
      mk('ghost','Gengar','Shadow Claw','Shadow Ball',18.30),
      mk('dark','Honchkrow','Snarl','Dark Pulse',18.00),
      mk('bug','Pinsir','Bug Bite','X-Scissor',17.70),
      mk('ghost','Mismagius','Hex','Shadow Ball',17.40),
      mk('dark','Absol','Snarl','Dark Pulse',17.10),
      mk('bug','Scizor','Fury Cutter','X-Scissor',16.80),
      mk('ghost','Drifblim','Hex','Shadow Ball',16.50),
      mk('dark','Zoroark','Snarl','Foul Play',16.20),
      mk('bug','Heracross','Struggle Bug','Megahorn',15.90),
    ],
  };
}

// ── HERO ─────────────────────────────────────────────────
function initHero() {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas) return;
  const isMobile = window.innerWidth < 768;
  const ctx = canvas.getContext('2d');
  let W, H, pts;
  const ptCount = isMobile ? 25 : 60;
  function resize() {
    W = canvas.width  = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
    pts = Array.from({length:ptCount}, () => ({
      x:Math.random()*W, y:Math.random()*H,
      vx:(Math.random()-0.5)*0.5, vy:(Math.random()-0.5)*0.5,
      r:Math.random()*2+0.5,
    }));
  }
  resize();
  window.addEventListener('resize', resize);
  let frame = 0;
  function tick() {
    frame++;
    if (!isMobile || frame % 2 === 0) {
      ctx.clearRect(0,0,W,H);
      pts.forEach(p => {
        p.x+=p.vx; p.y+=p.vy;
        if(p.x<0)p.x=W; if(p.x>W)p.x=0;
        if(p.y<0)p.y=H; if(p.y>H)p.y=0;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
        ctx.fillStyle='rgba(120,200,80,0.4)'; ctx.fill();
      });
      for(let i=0;i<pts.length;i++) for(let j=i+1;j<pts.length;j++) {
        const d=Math.hypot(pts[i].x-pts[j].x,pts[i].y-pts[j].y);
        if(d<120){
          ctx.beginPath(); ctx.moveTo(pts[i].x,pts[i].y); ctx.lineTo(pts[j].x,pts[j].y);
          ctx.strokeStyle=`rgba(120,200,80,${(1-d/120)*0.1})`; ctx.lineWidth=0.5; ctx.stroke();
        }
      }
    } else {
      // Still update positions on skipped frames so animation stays smooth
      pts.forEach(p => {
        p.x+=p.vx; p.y+=p.vy;
        if(p.x<0)p.x=W; if(p.x>W)p.x=0;
        if(p.y<0)p.y=H; if(p.y>H)p.y=0;
      });
    }
    requestAnimationFrame(tick);
  }
  tick();
  window.addEventListener('scroll', () => {
    const p=Math.min(1,window.scrollY/window.innerHeight);
    const c=document.querySelector('.hero__content');
    if(c){ c.style.transform=`translateY(${p*60}px)`; c.style.opacity=1-p*1.5; }
  },{passive:true});
}

// ── CH1: STACKED BAR CHART ───────────────────────────────
let barChartMode = 'simple'; // 'simple' | 'legendary'

function buildTypeBarChart() {
  // Wire up toggle buttons (safe to call multiple times — clones prevent double-listeners)
  document.querySelectorAll('.bar-mode-btn').forEach(btn => {
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', () => {
      barChartMode = fresh.dataset.mode;
      document.querySelectorAll('.bar-mode-btn').forEach(b => b.classList.remove('active'));
      fresh.classList.add('active');
      renderBarChart();
      // Re-animate
      setTimeout(animateBars, 50);
    });
  });
  renderBarChart();
}

function renderBarChart() {
  const el = document.getElementById('typeBarChart');
  if (!el || !Object.keys(typeStats).length) return;

  const sorted  = Object.entries(typeStats).sort((a,b) => b[1].overallAvg - a[1].overallAvg);
  const nTypes  = sorted.length;
  const bugRank = sorted.findIndex(([t]) => t === 'bug');
  const bugAvg  = typeStats['bug']?.overallAvg || 0;
  const allAvg  = Object.values(typeStats).reduce((s,t) => s+t.overallAvg, 0) / nTypes;

  // Shared verdict stats
  const v1=document.getElementById('vstat1');
  if(v1) v1.textContent = bugRank>=0 ? `#${bugRank+1} / ${nTypes}` : '—';
  const fnote=document.getElementById('verdictFootnote');
  if(fnote) fnote.textContent=`Based on ${allPokemon.length} Pokémon across ${nTypes} types.`;
  const note1=document.getElementById('ch1Note');
  if(note1&&bugRank>=0) note1.textContent=`🐛 Bug ranks #${bugRank+1} out of ${nTypes} types`;

  if (barChartMode === 'simple') {
    // ── SIMPLE MODE: single bar = overall avg, baseline 90 ──
    const maxAvg   = sorted[0][1].overallAvg;
    const scaleMin = 113;
    const scaleRange = maxAvg - scaleMin;
    const tickVals = [scaleMin, ...([1,2,3].map(i => Math.round(scaleMin + scaleRange*(i/4)))), Math.round(maxAvg)];

    el.innerHTML = `
      <div class="hbar-axis">
        <div class="hbar-label"></div>
        <div class="hbar-track hbar-track--axis">
          ${tickVals.map(v => `<span class="hbar-tick" style="left:${((v-scaleMin)/scaleRange)*100}%">${v}</span>`).join('')}
        </div>
        <div class="hbar-val"></div>
      </div>` +
      sorted.map(([type, data], i) => {
        const isBug = type === 'bug';
        const color = TYPE_COLORS[type] || TYPE_COLORS.default;
        const pct   = ((data.overallAvg - scaleMin) / scaleRange) * 100;
        return `<div class="hbar-row" data-i="${i}" data-bug="${isBug}"
                   data-reg-pct="${pct.toFixed(2)}" data-leg-pct="0" data-leg-left="0">
          <div class="hbar-label">${type}${isBug?' 🐛':''}</div>
          <div class="hbar-track">
            <div class="hbar-fill hbar-fill--reg${isBug?' bug-reg':''}"
                 data-pct="${pct.toFixed(2)}"
                 style="width:0%;left:0;${isBug?'':'background:'+color+';opacity:1;'}"></div>
          </div>
          <div class="hbar-val">
            <span class="hbar-val-reg">${Math.round(data.overallAvg)}</span>
          </div>
        </div>`;
      }).join('');

  } else {
    // ── LEGENDARY MODE: stacked reg + leg segments ──
    const maxRegAvg  = Math.max(...sorted.map(([,d]) => d.regularAvg  || 0));
    const maxLegAvg  = Math.max(...sorted.map(([,d]) => d.legendaryAvg || 0));
    const absMax     = Math.max(maxRegAvg, maxLegAvg);
    const scaleMin   = 113;
    const scaleRange = absMax - scaleMin;
    const tickVals   = [scaleMin, ...([1,2,3].map(i => Math.round(scaleMin + scaleRange*(i/4)))), Math.round(absMax)];

    el.innerHTML = `
      <div class="hbar-axis">
        <div class="hbar-label"></div>
        <div class="hbar-track hbar-track--axis">
          ${tickVals.map(v => `<span class="hbar-tick" style="left:${((v-scaleMin)/scaleRange)*100}%">${v}</span>`).join('')}
        </div>
        <div class="hbar-val"></div>
      </div>
      <div class="hbar-legend">
        <span class="hbar-legend-swatch hbar-legend-reg"></span><span>Regular</span>
        <span class="hbar-legend-swatch hbar-legend-leg"></span><span>Legendary</span>
      </div>` +
      sorted.map(([type, data], i) => {
        const isBug  = type === 'bug';
        const color  = TYPE_COLORS[type] || TYPE_COLORS.default;
        const regVal = Math.max(0, (data.regularAvg  || 0) - scaleMin);
        const legVal = Math.max(0, (data.legendaryAvg || 0) - scaleMin);
        const regPctRaw = (regVal / scaleRange) * 100;
        const legPctRaw = (legVal / scaleRange) * 100;
        const regPct = Math.max(0, Math.min(100, regPctRaw));
        // Render legendary as the delta beyond regular so stacked width stays within track.
        const legPct = Math.max(0, Math.min(100 - regPct, legPctRaw - regPctRaw));
        const legLeft = regPct;
        return `<div class="hbar-row" data-i="${i}" data-bug="${isBug}"
                   data-reg-pct="${regPct.toFixed(2)}"
                   data-leg-pct="${legPct.toFixed(2)}"
                   data-leg-left="${legLeft.toFixed(2)}">
          <div class="hbar-label">${type}${isBug?' 🐛':''}</div>
          <div class="hbar-track">
            <div class="hbar-fill hbar-fill--reg${isBug?' bug-reg':''}"
                 data-pct="${regPct.toFixed(2)}"
                 style="width:0%;left:0;${isBug?'':'background:'+color+';opacity:1;'}"></div>
            ${isBug ? '' : `<div class="hbar-fill hbar-fill--leg"
                 data-pct="${legPct.toFixed(2)}"
                 data-left="${legLeft.toFixed(2)}"
                 style="width:0%;left:${legLeft.toFixed(2)}%;background:${color};opacity:0.35;"></div>`}
          </div>
          <div class="hbar-val">
            ${data.regularAvg   > 0 ? `<span class="hbar-val-reg">${Math.round(data.regularAvg)}</span>` : ''}
            ${data.legendaryAvg > 0 ? `<span class="hbar-val-leg">/ ${Math.round(data.legendaryAvg)}</span>` : (isBug ? `<span class="hbar-val-none">no legendaries</span>` : '')}
          </div>
        </div>`;
      }).join('');
  }
}

function animateBars() {
  const rows = Array.from(document.querySelectorAll('.hbar-row'));
  if (!rows.length) { setTimeout(animateBars, 200); return; }
  let current = 0;

  function fireNext() {
    if (current >= rows.length) return;
    const row    = rows[current];
    const regFill = row.querySelector('.hbar-fill--reg');
    const legFill = row.querySelector('.hbar-fill--leg');
    const val     = row.querySelector('.hbar-val');
    const isBug   = row.dataset.bug === 'true';
    const regPct  = parseFloat(row.dataset.regPct) || 0;
    const legPct  = parseFloat(row.dataset.legPct) || 0;
    current++;

    const ease = isBug ? 'cubic-bezier(0.34,1.7,0.64,1)' : 'cubic-bezier(0.16,1,0.3,1)';
    const dur  = isBug ? '0.3s' : '0.16s';

    // Animate regular segment
    if (regFill && regPct > 0) {
      regFill.style.transition = `width ${dur} ${ease}`;
      regFill.style.width = regPct + '%';
    }

    // Animate legendary segment — skipped for Bug (no leg fill rendered)
    setTimeout(() => {
      if (legFill && legPct > 0 && !isBug) {
        const legLeft = parseFloat(legFill.dataset.left) || regPct;
        legFill.style.left = legLeft + '%';
        legFill.style.transition = `width ${dur} ${ease}`;
        legFill.style.width = legPct + '%';
      }
    }, 90);

    // Show value label and fire next bar
    const delay = isBug ? 300 : 170;
    setTimeout(() => {
      val?.classList.add('animate');
      if (isBug) legFill?.classList.add('bug-pulse');
      fireNext();
    }, delay);
  }

  fireNext();
}

// ── CH2: SCATTER ─────────────────────────────────────────
function buildScatter() {
  const canvas = document.getElementById('scatterCanvas');
  if (!canvas || !allPokemon.length) return;
  const isMobile = window.innerWidth < 768;
  // Size canvas: walk up DOM for real dimensions, fall back to viewport
  let sizeEl = canvas.parentElement;
  while (sizeEl && sizeEl.clientWidth < 10) sizeEl = sizeEl.parentElement;
  const rawW = sizeEl ? sizeEl.clientWidth  * (isMobile ? 0.98 : 0.92) : 0;
  const rawH = sizeEl ? sizeEl.clientHeight * (isMobile ? 0.70 : 0.85) : 0;
  const W = rawW > 10 ? rawW : window.innerWidth  * 0.45;
  const H = rawH > 10 ? rawH : window.innerHeight * 0.65;

  const xCol    =statCols.includes(COLS.attack) ?COLS.attack :statCols[0];
  const yCol    =statCols.includes(COLS.defense)?COLS.defense:(statCols[1]||statCols[0]);
  const t1Col   =headers.includes(COLS.type1)   ?COLS.type1 :(headers.find(h=>/type.?1/i.test(h))||'type1');
  const stamCol =statCols.includes(COLS.stamina)?COLS.stamina:null;

  const dpr=window.devicePixelRatio||1;
  canvas.width=W*dpr; canvas.height=H*dpr;
  canvas.style.width=W+'px'; canvas.style.height=H+'px';
  const ctx=canvas.getContext('2d'); ctx.scale(dpr,dpr);
  const PAD = isMobile ? {t:10,r:10,b:40,l:45} : {t:24,r:24,b:56,l:64};

  const allS=stamCol?allPokemon.map(p=>parseFloat(p[stamCol])||0).filter(v=>v>0):[];
  const maxS=allS.length?Math.max(...allS):1, minS=allS.length?Math.min(...allS):0;
  const toR=(s,bug)=>{ 
    const t = maxS > minS ? (s - minS) / (maxS - minS) : 0.5; 
    return 2 + t * 10; // All bubbles now scale from 2px to 12px based purely on stamina
  };

  const vals=allPokemon.map(p=>({
    x:parseFloat(p[xCol])||0, y:parseFloat(p[yCol])||0,
    s:stamCol?parseFloat(p[stamCol])||0:0,
    t1:(p[t1Col]||'').toLowerCase().trim(),
    bug:(p[t1Col]||'').toLowerCase().trim()==='bug',
  })).filter(v=>v.x>0&&v.y>0);
  if(!vals.length) return;

  const xMin=Math.min(...vals.map(v=>v.x)),xMax=Math.max(...vals.map(v=>v.x));
  const yMin=Math.min(...vals.map(v=>v.y)),yMax=Math.max(...vals.map(v=>v.y));
  const xP=(xMax-xMin)*0.05, yP=(yMax-yMin)*0.05;
  const scX=x=>PAD.l+((x-xMin+xP)/(xMax-xMin+xP*2))*(W-PAD.l-PAD.r);
  const scY=y=>H-PAD.b-((y-yMin+yP)/(yMax-yMin+yP*2))*(H-PAD.t-PAD.b);

  const bugs=vals.filter(v=>v.t1==='bug');
  const bx=bugs.length?bugs.reduce((s,v)=>s+v.x,0)/bugs.length:0;
  const by=bugs.length?bugs.reduce((s,v)=>s+v.y,0)/bugs.length:0;
  const ordered=[...vals.filter(v=>!v.bug),...vals.filter(v=>v.bug)];
  function hexToRgb(hex) {
    const clean = (hex || '').replace('#', '').trim();
    if (clean.length !== 6) return '120,200,80';
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if ([r, g, b].some(v => Number.isNaN(v))) return '120,200,80';
    return `${r},${g},${b}`;
  }

  function draw(n) {
    ctx.clearRect(0,0,W,H);
    for(let i=0;i<=5;i++){
      const xv=xMin+(xMax-xMin)*(i/5),yv=yMin+(yMax-yMin)*(i/5);
      const gx=scX(xv),gy=scY(yv);
      ctx.strokeStyle='rgba(232,240,232,0.06)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(PAD.l,gy); ctx.lineTo(W-PAD.r,gy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx,PAD.t); ctx.lineTo(gx,H-PAD.b); ctx.stroke();
      ctx.fillStyle='rgba(232,240,232,0.3)'; ctx.font='12px IBM Plex Mono';
      ctx.textAlign='right'; ctx.fillText(Math.round(yv),PAD.l-6,gy+4);
      ctx.textAlign='center'; ctx.fillText(Math.round(xv),gx,H-PAD.b+18);
    }
    ctx.fillStyle='rgba(232,240,232,0.45)'; ctx.font='14px IBM Plex Mono';
    ctx.textAlign='center'; ctx.fillText('BASE ATTACK',W/2,H-8);
    ctx.save(); ctx.translate(14,H/2); ctx.rotate(-Math.PI/2); ctx.fillText('BASE DEFENSE',0,0); ctx.restore();
    ctx.strokeStyle='rgba(232,240,232,0.15)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(PAD.l,PAD.t); ctx.lineTo(PAD.l,H-PAD.b); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PAD.l,H-PAD.b); ctx.lineTo(W-PAD.r,H-PAD.b); ctx.stroke();
    if(bugs.length&&n>ordered.length*0.5){
      const g=ctx.createRadialGradient(scX(bx),scY(by),0,scX(bx),scY(by),80);
      g.addColorStop(0,'rgba(120,200,80,0.1)'); g.addColorStop(1,'rgba(120,200,80,0)');
      ctx.beginPath(); ctx.ellipse(scX(bx),scY(by),80,60,0,0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
    }
    const count=Math.min(n,ordered.length);
    for(let i=0;i<count;i++){
      const v=ordered[i],cx=scX(v.x),cy=scY(v.y),r=toR(v.s,v.bug);
      const isHighlightedType =
        scatterHighlightType !== 'all' && v.t1 === scatterHighlightType;
      const dimOthers =
        scatterHighlightType !== 'all' && v.t1 !== scatterHighlightType;

      const bugHighlightActive = scatterBugHighlightOn && v.bug;
      if(bugHighlightActive || isHighlightedType){
        const g=ctx.createRadialGradient(cx,cy,0,cx,cy,r+8);
        if (isHighlightedType && !bugHighlightActive) {
          const c = TYPE_COLORS[scatterHighlightType] || BUG_COLOR;
          const rgb = hexToRgb(c);
          g.addColorStop(0,`rgba(${rgb},0.28)`); g.addColorStop(1,`rgba(${rgb},0)`);
        } else {
          g.addColorStop(0,'rgba(120,200,80,0.3)'); g.addColorStop(1,'rgba(120,200,80,0)');
        }
        ctx.beginPath(); ctx.arc(cx,cy,r+8,0,Math.PI*2); ctx.fillStyle=g; ctx.fill();
        ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
        if (isHighlightedType && !bugHighlightActive) {
          const c = TYPE_COLORS[scatterHighlightType] || BUG_COLOR;
          ctx.fillStyle=c; ctx.fill();
          ctx.strokeStyle='rgba(226,237,226,0.65)'; ctx.lineWidth=1; ctx.stroke();
        } else {
          ctx.fillStyle=BUG_COLOR; ctx.fill();
          ctx.strokeStyle='#b8f060'; ctx.lineWidth=1; ctx.stroke();
        }
      } else {
        ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2);
        ctx.fillStyle = dimOthers ? 'rgba(232,240,232,0.08)' : 'rgba(232,240,232,0.18)';
        ctx.fill();
      }
    }
  }
  let reveal=0;
  function anim(){ draw(reveal); reveal+=8; if(reveal<ordered.length) requestAnimationFrame(anim); else draw(ordered.length); }
  anim();

  // Controls
  const controlsEl = document.getElementById('scatterControls');
  if (controlsEl) {
    const allTypes = Object.keys(typeStats).sort((a, b) => a.localeCompare(b));
    controlsEl.innerHTML = [
      `<button class="scatter-btn${scatterHighlightType === 'all' ? ' active' : ''}" data-type="all">Show all</button>`,
      ...allTypes.map(t =>
        `<button class="scatter-btn${scatterHighlightType === t ? ' active' : ''}" data-type="${t}">${t[0].toUpperCase()}${t.slice(1)}</button>`
      ),
      `<button class="scatter-btn scatter-btn--toggle${scatterBugHighlightOn ? ' active' : ''}" data-toggle="bug-highlight">${scatterBugHighlightOn ? 'Bug glow: on' : 'Bug glow: off'}</button>`,
    ].join('');

    controlsEl.querySelectorAll('.scatter-btn[data-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        scatterHighlightType = btn.dataset.type || 'all';
        buildScatter();
      });
    });
    const bugToggle = controlsEl.querySelector('.scatter-btn[data-toggle="bug-highlight"]');
    bugToggle?.addEventListener('click', () => {
      scatterBugHighlightOn = !scatterBugHighlightOn;
      buildScatter();
    });
  }

  const n2=document.getElementById('ch2Note');
  if(n2&&bugs.length){
    const ax=vals.reduce((s,v)=>s+v.x,0)/vals.length, ay=vals.reduce((s,v)=>s+v.y,0)/vals.length;
    n2.textContent=`🐛 Bug avg attack ${Math.round(bx)}, defense ${Math.round(by)} · Overall ${Math.round(ax)}, ${Math.round(ay)}`;
    const v2 = document.getElementById('vstat2');
    if (v2) {
      const atkDelta = Math.round(bx - ax);
      const defDelta = Math.round(by - ay);
      const atkTxt = atkDelta > 0 ? `+${atkDelta}` : `${atkDelta}`;
      const defTxt = defDelta > 0 ? `+${defDelta}` : `${defDelta}`;
      v2.textContent = `${atkTxt} / ${defTxt}`;
    }
  }
}

// ── GLOBAL BACKGROUND PARTICLES ─────────────────────────
// Shared draw helpers used by both the bg canvas and pie section canvas
function drawHexParticle(ctx, x, y, r, alpha, hue) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    i === 0 ? ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a))
            : ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  ctx.closePath();
  ctx.strokeStyle = `hsla(${hue}, 65%, 55%, ${alpha})`;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawLeafParticle(ctx, x, y, r, rot, alpha, hue) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.bezierCurveTo(r * 0.8, -r * 0.5, r * 0.8, r * 0.5, 0, r);
  ctx.bezierCurveTo(-r * 0.8, r * 0.5, -r * 0.8, -r * 0.5, 0, -r);
  ctx.fillStyle = `hsla(${hue}, 55%, 42%, ${alpha})`;
  ctx.fill();
  ctx.restore();
}

function renderParticles(ctx, particles, W, H) {
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy; p.rot += p.rotV;
    if (p.y < -30)     p.y = H + 30;
    if (p.x < -30)     p.x = W  + 30;
    if (p.x > W  + 30) p.x = -30;
    if (p.type === 'hex')  drawHexParticle(ctx, p.x, p.y, p.size, p.alpha, p.hue);
    if (p.type === 'leaf') drawLeafParticle(ctx, p.x, p.y, p.size * 0.6, p.rot, p.alpha * 0.75, p.hue);
    if (p.type === 'dot') {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 65%, 55%, ${p.alpha * 1.1})`;
      ctx.fill();
    }
    if (p.type === 'ring') {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.5, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${p.hue}, 55%, 50%, ${p.alpha * 0.6})`;
      ctx.lineWidth = 0.8; ctx.stroke();
    }
  });
}

function makeParticles(count, W, H) {
  const types = ['hex','leaf','dot','ring'];
  return Array.from({ length: count }, (_, i) => ({
    x:    Math.random() * W,
    y:    Math.random() * H,
    vx:   (Math.random() - 0.5) * 0.25,
    vy:   -Math.random() * 0.35 - 0.08,
    size: Math.random() * 10 + 5,
    alpha: Math.random() * 0.35 + 0.1,  // more visible: 0.1–0.45
    rot:  Math.random() * Math.PI * 2,
    rotV: (Math.random() - 0.5) * 0.008,
    type: types[i % 4],
    hue:  Math.random() > 0.65 ? 88 : 118,
  }));
}

function initBgParticles() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  const isMobile = window.innerWidth < 768;
  const ctx = canvas.getContext('2d');
  let W, H, particles;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    particles = makeParticles(isMobile ? 25 : 70, W, H);
  }
  resize();
  window.addEventListener('resize', resize);

  let frame = 0;
  function tick() {
    frame++;
    // On mobile, only render every 3rd frame to reduce scroll jank
    if (!isMobile || frame % 3 === 0) {
      ctx.clearRect(0, 0, W, H);
      renderParticles(ctx, particles, W, H);
    }
    requestAnimationFrame(tick);
  }
  tick();
}

// Pie section gets extra-dense particles layered on top of the bg
function initPieParticles() {
  const canvas = document.getElementById('pieParticleCanvas');
  if (!canvas) return;
  const isMobile = window.innerWidth < 768;
  const parent = canvas.parentElement;

  function resize() {
    canvas.width  = parent.clientWidth;
    canvas.height = parent.clientHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const ctx = canvas.getContext('2d');
  let particles = makeParticles(isMobile ? 10 : 22, canvas.width, canvas.height);

  let frame = 0;
  function tick() {
    frame++;
    if (!isMobile || frame % 3 === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      renderParticles(ctx, particles, canvas.width, canvas.height);
    }
    requestAnimationFrame(tick);
  }
  tick();
}

// ── CH3: DONUT PIE CHART with hover tooltip ──────────────
// How many Pokémon of each type are super-effective against each defending type
const TYPE_WEAKNESSES = {
  normal:   ['fighting'],
  fire:     ['water','ground','rock'],
  water:    ['electric','grass'],
  grass:    ['bug','fire','flying','ice','poison'],
  electric: ['ground'],
  ice:      ['fire'... (40 KB left)
