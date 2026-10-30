// Pure search helpers (no DOM): query expansion (synonyms + French), ranking, variant de-duplication.
// Works in the browser (window.SearchUtils) and in Node (require) so it can be unit-tested.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SearchUtils = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const strip = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const words = (q) => strip(q).split(/[^a-z0-9]+/).filter(Boolean);
  const singular = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

  // Keys are accent-stripped lowercase. Values are English search terms, most canonical first.
  const SYN = {
    // English synonyms
    warning: ['alert', 'caution', 'danger'], alert: ['warning', 'caution'], caution: ['warning', 'alert'],
    danger: ['warning', 'alert'], lock: ['padlock', 'security'], padlock: ['lock'],
    security: ['shield', 'lock'], shield: ['protection', 'security'], protection: ['shield'],
    fire: ['flame'], flame: ['fire'], solar: ['solar-panel', 'sun', 'panel'],
    hydrogen: ['atom', 'molecule', 'gas'], leaf: ['plant', 'eco', 'nature'], plant: ['leaf', 'sprout'],
    eco: ['leaf', 'plant'], car: ['vehicle', 'automobile'], vehicle: ['car'], automobile: ['car'],
    people: ['users', 'group', 'team', 'person'], person: ['user'], user: ['person'], team: ['users', 'group'],
    energy: ['bolt', 'lightning', 'power'], power: ['bolt', 'plug'], electricity: ['bolt', 'plug'],
    wind: ['turbine', 'windmill'], factory: ['industry'], money: ['coin', 'cash'], idea: ['lightbulb'],
    // French
    usine: ['factory', 'industry'], voiture: ['car', 'vehicle'], auto: ['car'], vehicule: ['vehicle', 'car'],
    camion: ['truck'], feuille: ['leaf', 'plant'], plante: ['plant', 'leaf'], arbre: ['tree'],
    bouclier: ['shield', 'protection'], soleil: ['sun'], solaire: ['solar', 'solar-panel', 'sun'],
    panneau: ['panel', 'sign'], eolienne: ['wind-turbine', 'turbine', 'windmill'], vent: ['wind'],
    eau: ['water', 'drop'], goutte: ['drop', 'water'], feu: ['fire', 'flame'], flamme: ['flame', 'fire'],
    cadenas: ['padlock', 'lock'], verrou: ['lock', 'padlock'], verrouiller: ['lock'], cle: ['key'],
    fleche: ['arrow'], fleches: ['arrow'], personne: ['person', 'user'], personnes: ['people', 'users', 'group'],
    gens: ['people', 'users'], utilisateur: ['user', 'person'], equipe: ['team', 'users', 'group'],
    maison: ['home', 'house'], batiment: ['building'], immeuble: ['building'], bureau: ['office', 'desk'],
    ordinateur: ['computer', 'laptop'], telephone: ['phone', 'smartphone'], courrier: ['mail', 'envelope'],
    document: ['file', 'document'], fichier: ['file', 'document'], dossier: ['folder'],
    graphique: ['chart', 'graph'], courbe: ['chart-line', 'line-chart'], donnees: ['database', 'data'],
    serveur: ['server'], nuage: ['cloud'], reseau: ['network'], monde: ['globe', 'world'], mondial: ['globe', 'world'],
    terre: ['earth', 'globe'], argent: ['money', 'coin'], banque: ['bank'], panier: ['cart', 'basket'],
    magasin: ['store', 'shop'], avertissement: ['warning', 'alert'], attention: ['warning', 'alert', 'caution'],
    alerte: ['alert', 'warning'], hydrogene: ['hydrogen', 'atom', 'molecule', 'gas'], gaz: ['gas'],
    batterie: ['battery'], stockage: ['storage', 'battery'], energie: ['energy', 'bolt', 'lightning'],
    electricite: ['electricity', 'bolt', 'plug'], electrique: ['electric', 'bolt', 'plug'], prise: ['plug'],
    borne: ['charging-station', 'ev-charger'], recharge: ['charge', 'charging'], moteur: ['engine', 'motor'],
    engrenage: ['gear', 'cog'], parametres: ['settings', 'gear'], parametre: ['settings', 'gear'],
    recherche: ['search'], chercher: ['search'], loupe: ['magnifier', 'search'], calendrier: ['calendar'],
    horloge: ['clock'], heure: ['clock', 'time'], chronometre: ['stopwatch', 'timer'], chrono: ['stopwatch', 'timer'],
    coeur: ['heart'], etoile: ['star'], cible: ['target'], drapeau: ['flag'], epingle: ['pin'], carte: ['map', 'card'],
    lieu: ['location', 'map-pin'], localisation: ['location', 'map-pin'], main: ['hand'], oeil: ['eye'],
    ampoule: ['lightbulb', 'idea'], fusee: ['rocket'], planete: ['planet'], laboratoire: ['flask', 'lab'],
    science: ['flask', 'science'], sante: ['health', 'medical'], hopital: ['hospital'], livre: ['book'],
    ecole: ['school'], education: ['school', 'education'], poubelle: ['trash', 'delete'], crayon: ['pencil', 'edit'],
    coche: ['check'], valider: ['check'], croix: ['close', 'x'], fermer: ['close', 'x'], ajouter: ['plus', 'add'],
    telecharger: ['download'], envoyer: ['send'], partager: ['share'], imprimer: ['print'], port: ['port', 'harbor'],
    mer: ['sea', 'wave'], montagne: ['mountain'], ville: ['city', 'building'], pont: ['bridge'], route: ['road'],
    avion: ['plane', 'airplane'], bateau: ['boat', 'ship'], train: ['train'], velo: ['bike', 'bicycle'],
    outil: ['tool', 'wrench'], outils: ['tools', 'wrench'], graphiques: ['chart', 'graph'],
  };

  const VARIANT = new Set(['outline', 'outlined', 'fill', 'filled', 'line', 'bold', 'thin', 'light', 'regular',
    'duotone', 'solid', 'sharp', 'rounded', 'linear', 'twotone', 'round', 'medium']);

  const uniq = (a) => Array.from(new Set(a));

  // -> { queries: [string], groups: [[{term, weight}]], known: boolean }
  function expandQuery(q) {
    const ws = words(q);
    if (!ws.length) return { queries: [], groups: [], known: false };
    const primary = ws.join(' ');
    const syn = (w) => SYN[w] || SYN[singular(w)] || [];
    let queries = [primary];
    const groups = [];
    let known = false;
    if (ws.length === 1) {
      const w = ws[0], s = singular(w);
      const ex = uniq([...(s !== w ? [s] : []), ...syn(w)]).slice(0, 3);
      known = syn(w).length > 0;
      queries = uniq([primary, ...ex]);
      groups.push([{ term: w, weight: 1 }, ...ex.map((t) => ({ term: t, weight: t === s ? 0.95 : 0.8 }))]);
    } else {
      ws.forEach((w) => {
        const ex = syn(w).slice(0, 2);
        if (ex.length) known = true;
        groups.push([{ term: w, weight: 1 }, ...ex.map((t) => ({ term: t, weight: 0.8 }))]);
      });
      const translated = ws.map((w) => (syn(w)[0] || singular(w))).join(' ');
      queries = uniq([primary, translated]);
    }
    return { queries, groups, known };
  }

  function matchScore(name, term) {
    if (name === term) return 100;
    const tokens = name.split('-');
    if (tokens.includes(term)) return Math.max(40, 70 - (tokens.length - 1) * 3);
    if (name.startsWith(term)) return 45;
    if (name.includes(term)) return 25;
    return 8;
  }

  function scoreIcon(full, groups, idx) {
    const name = full.slice(full.indexOf(':') + 1);
    const tokens = name.split('-');
    let total = 0;
    for (const g of groups) {
      let best = 0;
      for (const a of g) best = Math.max(best, matchScore(name, a.term) * a.weight);
      total += best;
    }
    let s = total / (groups.length || 1);
    if (!tokens.some((t) => VARIANT.has(t))) s += 2;
    return s - idx * 0.001;
  }

  // lists: arrays of 'prefix:name' (first = results for the user's own query). -> [{id, idx}]
  function mergeResults(lists) {
    const best = new Map();
    lists.forEach((list, li) => {
      (list || []).forEach((id, pos) => {
        const idx = pos + (li === 0 ? 0 : 3);
        if (!best.has(id) || best.get(id) > idx) best.set(id, idx);
      });
    });
    return Array.from(best, ([id, idx]) => ({ id, idx }));
  }

  function baseOf(full) {
    const i = full.indexOf(':');
    const prefix = full.slice(0, i), tokens = full.slice(i + 1).split('-');
    const kept = tokens.filter((t) => !VARIANT.has(t));
    return prefix + ':' + (kept.length ? kept : tokens).join('-');
  }

  function rank(merged, groups, opts) {
    const sorted = merged
      .map((m) => ({ id: m.id, s: scoreIcon(m.id, groups, m.idx) }))
      .sort((a, b) => b.s - a.s)
      .map((m) => m.id);
    if (!(opts && opts.hideVariants)) return sorted;
    const seen = new Set();
    return sorted.filter((id) => {
      const b = baseOf(id);
      if (seen.has(b)) return false;
      seen.add(b);
      return true;
    });
  }

  // Short hint for empty results.
  function suggestions(q) {
    const ws = words(q);
    const out = [];
    ws.forEach((w) => {
      const keys = Object.keys(SYN).filter((k) => w.length >= 3 && (k.startsWith(w.slice(0, 3)) || w.startsWith(k.slice(0, 3))));
      keys.slice(0, 2).forEach((k) => out.push(SYN[k][0]));
    });
    const list = uniq(out).slice(0, 4);
    return list.length ? list : ['factory', 'solar panel', 'arrow', 'user'];
  }

  const humanize = (name) => String(name).replace(/-/g, ' ');

  return { strip, words, expandQuery, scoreIcon, mergeResults, rank, baseOf, suggestions, humanize, SYN };
});
