const API = 'https://api.iconify.design';
const CURATED = 'material-symbols,mdi,lucide,tabler,ph,bi,heroicons,carbon,ri,fa6-solid';
const PAGE = 48;

const $ = (id) => document.getElementById(id);
const grid = $('grid'), statusEl = $('status'), moreBtn = $('more'), input = $('q'), setSel = $('set'), colorIn = $('color');
let start = 0, total = 0, currentKey = '', timer;
const collections = {};     // prefix -> {name, license, author} from search responses
const iconData = new Map(); // 'prefix:name' -> {body, width, height}

const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
const thumbColor = dark ? '#f0f0f0' : '#242424';

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
}

function prefixesFor(choice) {
  if (choice === 'curated') return CURATED;
  if (choice === 'all') return '';
  return choice;
}

function splitName(full) {
  const i = full.indexOf(':');
  return { prefix: full.slice(0, i), name: full.slice(i + 1) };
}

// One request per icon set (not per icon): Iconify's bulk endpoint returns the raw icon data,
// and the SVG is built locally. Far fewer requests, and no cross-origin image loading.
async function loadIconData(fullNames) {
  const byPrefix = {};
  fullNames.forEach((f) => {
    const { prefix, name } = splitName(f);
    (byPrefix[prefix] = byPrefix[prefix] || []).push(name);
  });
  await Promise.all(
    Object.entries(byPrefix).map(async ([prefix, names]) => {
      const res = await fetch(`${API}/${prefix}.json?icons=${names.join(',')}`);
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
      });
    })
  );
}

function buildSvg(d, color, size) {
  const body = d.body.replace(/currentColor/g, color);
  const w = Math.max(1, Math.round((size * d.width) / d.height));
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${size}" viewBox="0 0 ${d.width} ${d.height}" fill="${color}">${body}</svg>`;
}

async function search(append = false) {
  const q = input.value.trim();
  const sets = setSel.value;
  const key = q + '|' + sets;
  if (!q) { grid.innerHTML = ''; moreBtn.hidden = true; setStatus('Type a keyword to find icons.'); return; }
  if (!append) { start = 0; total = 0; grid.innerHTML = ''; currentKey = key; }
  setStatus('Searching…');
  try {
    const params = new URLSearchParams({ query: q, limit: String(PAGE), start: String(start) });
    const prefixes = prefixesFor(sets);
    if (prefixes) params.set('prefixes', prefixes);
    const res = await fetch(`${API}/search?${params}`);
    if (!res.ok) throw new Error('Search failed (' + res.status + ')');
    const data = await res.json();
    if (key !== currentKey) return; // a newer search replaced this one
    Object.assign(collections, data.collections || {});
    const icons = data.icons || [];
    let dataError = '';
    try { await loadIconData(icons); } catch (e) { dataError = e.message; }
    if (key !== currentKey) return;
    icons.forEach(addTile);
    start += icons.length;
    total = data.total || 0;
    moreBtn.hidden = !(icons.length && start < total);
    if (dataError) setStatus('Previews failed: ' + dataError, true);
    else setStatus(grid.children.length ? 'Click an icon to insert it on the slide.' : `No icons found for “${q}”.`);
  } catch (e) {
    setStatus(e.message, true);
  }
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

async function insertIcon(full, tile) {
  const { prefix } = splitName(full);
  tile.classList.add('busy');
  setStatus('Inserting…');
  try {
    if (!iconData.has(full)) await loadIconData([full]);
    const d = iconData.get(full);
    if (!d) throw new Error('Icon data not available.');
    const svg = buildSvg(d, colorIn.value, 256);
    await new Promise((resolve, reject) => {
      Office.context.document.setSelectedDataAsync(svg, { coercionType: Office.CoercionType.XmlSvg }, (r) =>
        r.status === Office.AsyncResultStatus.Succeeded ? resolve() : reject(new Error(r.error.message))
      );
    });
    const c = collections[prefix];
    const credit = c ? `${c.name}${c.license && c.license.title ? ' · ' + c.license.title : ''}` : prefix;
    const hint = /stroke=["']#/.test(svg) ? ' Outline icon: recolor with Graphics Outline.' : '';
    setStatus(`Inserted ${full} (${credit}).${hint}`);
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    tile.classList.remove('busy');
  }
}

Office.onReady(() => {
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => search(false), 350); });
  setSel.addEventListener('change', () => search(false));
  moreBtn.addEventListener('click', () => search(true));
});
