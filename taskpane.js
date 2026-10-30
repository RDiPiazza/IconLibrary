const API = 'https://api.iconify.design';
const CURATED = 'material-symbols,mdi,lucide,tabler,ph,bi,heroicons,carbon,ri,fa6-solid';
const PAGE = 48;      // tiles shown per "page"
const FETCH_LIMIT = 120; // results requested from Iconify per query; ranking happens client-side
// Theme colours, primary accent first. Shown as one-click swatches under the search box.
const BRAND = [
  ['Blue', '#0050DB'], ['Mint', '#50E6BE'], ['Text dark', '#101820'], ['Charcoal', '#2E2E2E'],
  ['Dark blue-grey', '#44546A'], ['Mid grey', '#ABABAB'], ['Light blue', '#CCDCF8'],
  ['Light mint', '#A7F2DE'], ['Light grey', '#E7E6E6'], ['White', '#FFFFFF'],
];
const FALLBACK_BELOW = 12; // curated results under this count also search every single-colour set

const U = window.SearchUtils;
const $ = (id) => document.getElementById(id);
const grid = $('grid'), statusEl = $('status'), moreBtn = $('more'), input = $('q'), colorIn = $('color');
let currentKey = '', timer, results = [], shown = 0, lastMerged = [], lastExtra = [], lastGroups = [], lastNote = '', lastQuery = '';
const collections = {};     // prefix -> {name, license, author}
const iconData = new Map(); // 'prefix:name' -> {body, width, height}
const missing = new Set();  // ids Iconify reported as not existing

const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
const thumbColor = dark ? '#f0f0f0' : '#242424';

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
}

function splitName(full) {
  const i = full.indexOf(':');
  return { prefix: full.slice(0, i), name: full.slice(i + 1) };
}

// One request per icon set (bulk endpoint); SVGs are built locally. Fetches on demand when an id
// isn't cached, and only reports "does not exist" when Iconify says so.
async function loadIconData(fullNames) {
  const byPrefix = {};
  fullNames.forEach((f) => {
    if (iconData.has(f)) return;
    const { prefix, name } = splitName(f);
    (byPrefix[prefix] = byPrefix[prefix] || []).push(name);
  });
  await Promise.all(
    Object.entries(byPrefix).map(async ([prefix, names]) => {
      const res = await fetch(`${API}/${prefix}.json?icons=${names.join(',')}`);
      if (res.status === 404) { names.forEach((n) => missing.add(prefix + ':' + n)); return; } // unknown icon set
      if (!res.ok) throw new Error('Icon data failed (' + res.status + ')');
      const data = await res.json();
      const dw = data.width || 16, dh = data.height || 16;
      const resolve = (n, depth = 0) => {
        if (data.icons && data.icons[n]) {
          const i = data.icons[n];
          return { body: i.body, width: i.width || dw, height: i.height || dh };
        }
        const a = data.aliases && data.aliases[n];
        if (a && depth < 5) {
          const p = resolve(a.parent, depth + 1);
          return p ? { body: p.body, width: a.width || p.width, height: a.height || p.height } : null;
        }
        return null;
      };
      names.forEach((n) => {
        const d = resolve(n);
        if (d) iconData.set(prefix + ':' + n, d);
        else if ((data.not_found || []).includes(n) || !data.icons || !data.icons[n]) missing.add(prefix + ':' + n);
      });
    })
  );
}

function buildSvg(d, color, size) {
  const body = d.body.replace(/currentColor/g, color);
  const w = Math.max(1, Math.round((size * d.width) / d.height));
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${size}" viewBox="0 0 ${d.width} ${d.height}" fill="${color}">${body}</svg>`;
}

async function fetchSearch(q, prefixes) {
  const params = new URLSearchParams({ query: q, limit: String(FETCH_LIMIT) });
  if (prefixes) params.set('prefixes', prefixes);
  const res = await fetch(`${API}/search?${params}`);
  if (!res.ok) throw new Error('Search failed (' + res.status + ')');
  return res.json();
}

async function search() {
  const q = input.value.trim();
  const key = q;
  currentKey = key;
  grid.innerHTML = ''; results = []; shown = 0; moreBtn.hidden = true;
  if (!q) { setStatus('Type a keyword (English or French) to find icons.'); return; }
  const { queries, groups } = U.expandQuery(q);
  if (!queries.length) { setStatus('Type a keyword (English or French) to find icons.'); return; }
  setStatus('Searching…');
  try {
    const settled = await Promise.allSettled(queries.map((qq) => fetchSearch(qq, CURATED)));
    if (key !== currentKey) return; // a newer search replaced this one
    const ok = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
    if (!ok.length) throw settled[0].reason;
    ok.forEach((d) => Object.assign(collections, d.collections || {}));
    lastMerged = U.mergeResults(settled.map((s) => (s.status === 'fulfilled' ? s.value.icons || [] : [])));
    lastExtra = [];
    lastNote = queries.length > 1 ? `Also searched: ${queries.slice(1).join(', ')}. ` : '';
    // Like iconify.design, fall back to every set when the curated ones have little; 'palette:false'
    // keeps it to single-colour icons. Shown after the curated results.
    if (lastMerged.length < FALLBACK_BELOW) {
      const more = await Promise.allSettled(queries.map((qq) => fetchSearch(qq + ' palette:false', '')));
      if (key !== currentKey) return;
      more.forEach((s) => { if (s.status === 'fulfilled') Object.assign(collections, s.value.collections || {}); });
      const inCurated = new Set(lastMerged.map((m) => m.id));
      lastExtra = U.mergeResults(more.map((s) => (s.status === 'fulfilled' ? s.value.icons || [] : [])))
        .filter((m) => !inCurated.has(m.id));
      if (lastExtra.length) lastNote += 'Few matches in the main sets; also showing other icon sets. ';
    }
    lastGroups = groups;
    lastQuery = q;
    await render();
  } catch (e) {
    setStatus('Search failed: ' + e.message, true);
  }
}

async function render() {
  grid.innerHTML = '';
  const opts = { hideVariants: true };
  results = U.rank(lastMerged, lastGroups, opts).concat(U.rank(lastExtra, lastGroups, opts));
  shown = 0;
  if (!results.length) {
    setStatus(`No icons found for “${lastQuery}”. Try: ${U.suggestions(lastQuery).join(', ')}.`);
    moreBtn.hidden = true;
    return;
  }
  await showMore();
}

async function showMore() {
  const key = currentKey;
  const slice = results.slice(shown, shown + PAGE);
  let dataError = '';
  try { await loadIconData(slice); } catch (e) { dataError = e.message; }
  if (key !== currentKey) return;
  slice.forEach(addTile);
  shown += slice.length;
  moreBtn.hidden = shown >= results.length;
  if (dataError) setStatus('Previews failed: ' + dataError, true);
  else setStatus(`${lastNote}Showing ${shown} of ${results.length}. Click an icon to insert it.`);
}

function addTile(full) {
  const b = document.createElement('button');
  b.className = 'icon';
  b.title = full;
  const img = document.createElement('img');
  const d = iconData.get(full);
  if (d) {
    img.alt = '';
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildSvg(d, thumbColor, 64));
  } else {
    img.alt = '!';
  }
  b.appendChild(img);
  b.addEventListener('click', () => insertIcon(full, b));
  grid.appendChild(b);
}

function insertData(data, coercionType) {
  return new Promise((resolve, reject) => {
    Office.context.document.setSelectedDataAsync(data, { coercionType }, (r) => {
      if (r.status === Office.AsyncResultStatus.Succeeded) return resolve();
      const err = r.error || {};
      reject(new Error((err.message || 'unknown error') + (err.code ? ' [' + err.code + ']' : '')));
    });
  });
}

async function svgToPngBase64(svg, px = 512) {
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = () => rej(new Error('could not render the SVG'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(px * ratio));
  c.height = px;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png').split(',')[1];
}

// Best effort: name the inserted shape after the icon and set its alt text.
async function nameSelection(full) {
  try {
    if (!window.PowerPoint || !PowerPoint.run) return;
    const label = U.label(full);
    await PowerPoint.run(async (ctx) => {
      const shapes = ctx.presentation.getSelectedShapes();
      shapes.load('items');
      await ctx.sync();
      if (shapes.items.length !== 1) return;
      const shape = shapes.items[0];
      shape.name = 'Icon - ' + label;
      await ctx.sync();
      try {
        shape.altTextDescription = label + ' icon';
        await ctx.sync();
      } catch (e) { /* alt-text API not available in this PowerPoint version */ }
    });
  } catch (e) { /* naming is best-effort */ }
}

async function insertIcon(full, tile) {
  const { prefix } = splitName(full);
  tile.classList.add('busy');
  setStatus('Inserting…');
  try {
    if (!iconData.has(full)) await loadIconData([full]); // on-demand fetch, no dependency on a prior search
    const d = iconData.get(full);
    if (!d) throw new Error(missing.has(full) ? `Icon “${full}” does not exist on Iconify.` : `Could not load “${full}” from Iconify. Check your connection and retry.`);
    const svg = buildSvg(d, colorIn.value, 256);

    // 1) SVG (recolorable). Try plain, then with an XML declaration.
    // 2) Fallback: PNG picture (not recolorable), so something always lands on the slide.
    let mode = '', svgErr = '';
    for (const variant of [svg, '<?xml version="1.0" encoding="UTF-8"?>' + svg]) {
      try { await insertData(variant, Office.CoercionType.XmlSvg); mode = 'svg'; break; }
      catch (e) { svgErr = e.message; }
    }
    if (!mode) {
      try {
        await insertData(await svgToPngBase64(svg), Office.CoercionType.Image);
        mode = 'png';
      } catch (e2) {
        throw new Error('Insert failed. SVG: ' + svgErr + ' | PNG: ' + e2.message);
      }
    }
    await nameSelection(full);
    const c = collections[prefix];
    const credit = c ? `${c.name}${c.license && c.license.title ? ' · ' + c.license.title : ''}` : prefix;
    if (mode === 'png') {
      setStatus(`Inserted ${full} as a picture (not recolorable). SVG insert failed: ${svgErr}. Credit: ${credit}.`);
    } else {
      const hint = /stroke=["']#/.test(svg) ? ' Outline icon: recolor with Graphics Outline.' : '';
      setStatus(`Inserted ${full} (${credit}).${hint}`);
    }
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    tile.classList.remove('busy');
  }
}

function buildSwatches() {
  const box = $('swatches');
  const list = document.createElement('datalist'); // offered as suggestions by pickers that support it
  list.id = 'brand-colours';
  BRAND.forEach(([name, hex]) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = hex;
    b.title = `${name} (${hex})`;
    b.setAttribute('aria-label', name);
    b.dataset.hex = hex.toLowerCase();
    b.addEventListener('click', () => { colorIn.value = hex.toLowerCase(); markSwatch(); });
    box.appendChild(b);
    const o = document.createElement('option');
    o.value = hex.toLowerCase();
    list.appendChild(o);
  });
  document.body.appendChild(list);
  colorIn.setAttribute('list', list.id);
  colorIn.addEventListener('input', markSwatch);
  markSwatch();
}

function markSwatch() {
  const v = colorIn.value.toLowerCase();
  document.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.hex === v)));
}

Office.onReady(() => {
  buildSwatches();
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 350); });
  moreBtn.addEventListener('click', showMore);
});
