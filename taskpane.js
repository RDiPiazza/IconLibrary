const API = 'https://api.iconify.design';
const CURATED = 'material-symbols,mdi,lucide,tabler,ph,bi,heroicons,carbon,ri,fa6-solid';
const PAGE = 48;

const $ = (id) => document.getElementById(id);
const grid = $('grid'), statusEl = $('status'), moreBtn = $('more'), input = $('q'), setSel = $('set'), colorIn = $('color');
let start = 0, total = 0, currentKey = '', timer;
const collections = {}; // prefix -> {name, license, author} from search responses

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
    (data.icons || []).forEach(addTile);
    start += (data.icons || []).length;
    total = data.total || 0;
    moreBtn.hidden = !((data.icons || []).length && start < total);
    setStatus(grid.children.length ? 'Click an icon to insert it on the slide.' : `No icons found for “${q}”.`);
  } catch (e) {
    setStatus(e.message, true);
  }
}

function splitName(full) {
  const i = full.indexOf(':');
  return { prefix: full.slice(0, i), name: full.slice(i + 1) };
}

function addTile(full) {
  const { prefix, name } = splitName(full);
  const b = document.createElement('button');
  b.className = 'icon';
  b.title = full;
  const img = document.createElement('img');
  img.alt = full;
  img.loading = 'lazy';
  img.src = `${API}/${prefix}/${name}.svg?height=64&color=${encodeURIComponent(thumbColor)}`;
  b.appendChild(img);
  b.addEventListener('click', () => insertIcon(full, b));
  grid.appendChild(b);
}

async function insertIcon(full, tile) {
  const { prefix, name } = splitName(full);
  tile.classList.add('busy');
  setStatus('Inserting…');
  try {
    const res = await fetch(`${API}/${prefix}/${name}.svg?height=256&color=${encodeURIComponent(colorIn.value)}`);
    if (!res.ok) throw new Error('Download failed (' + res.status + ')');
    const svg = await res.text();
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
