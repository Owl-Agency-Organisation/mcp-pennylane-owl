// Pagination par curseur. Tout outil de liste renvoie la meme enveloppe :
// { items, count, has_more, next_cursor, truncated }.
//
// `count` est le nombre d'elements renvoyes, jamais un total de la ressource.
// `has_more` et `next_cursor` sont remontes tels que Pennylane les renvoie.
// https://pennylane.readme.io/docs/using-cursor-based-pagination

// Plafonds de fetch_all. Les pages sont lues en sequence, cadencees par le
// client HTTP : 10 pages prennent quelques secondes, et le budget de temps
// reste tres en dessous de la duree maximale d'une fonction Vercel comme du
// delai d'attente d'un client MCP.
export const FETCH_ALL_MAX_PAGES = 10;
export const FETCH_ALL_TIME_BUDGET_MS = 25_000;

// Plafond de taille des elements renvoyes par fetch_all, en caracteres de
// JSON compact. Au-dela, la reponse sature la fenetre de contexte d'un
// modele : mesure du 24/09/2026, les 981 ecritures d'un exercice pesent
// 702 000 caracteres. Une page qui ferait depasser le plafond est ecartee,
// et son curseur devient next_cursor : la reprise reste exacte.
export const FETCH_ALL_MAX_CHARS = 100_000;

// L'API renvoie tantot un tableau brut, tantot un objet pagine. Cette
// normalisation evite les `.length` / `.find()` sur un objet.
export function asArray(data, ...keys) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['items', ...keys]) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return [];
}

// `fetchPage(cursor)` renvoie une page brute de l'API. Sans fetch_all, une
// seule page est lue. Avec fetch_all, les pages suivantes sont lues tant que
// l'API en annonce et que les plafonds le permettent.
export async function paginate(fetchPage, {
  cursor = null,
  fetchAll = false,
  itemKeys = [],
  maxPages = FETCH_ALL_MAX_PAGES,
  timeBudgetMs = FETCH_ALL_TIME_BUDGET_MS,
  maxChars = FETCH_ALL_MAX_CHARS,
  now = () => Date.now(),
} = {}) {
  const started = now();
  const items = [];
  let chars = 0;
  let pageCursor = cursor || null;
  let hasMore = null;
  let pages = 0;
  let sizeCapped = false;

  for (;;) {
    const page = await fetchPage(pageCursor);
    const pageItems = asArray(page, ...itemKeys);
    const pageChars = JSON.stringify(pageItems).length;

    // La premiere page est toujours rendue : `limit` en regle la taille.
    if (fetchAll && pages > 0 && chars + pageChars > maxChars) {
      // Page ecartee : pageCursor, qui a servi a la lire, reste le curseur
      // de reprise, et l'API a deja annonce cette suite.
      sizeCapped = true;
      hasMore = true;
      break;
    }

    pages++;
    items.push(...pageItems);
    chars += pageChars;
    hasMore = page?.has_more ?? null;
    pageCursor = page?.next_cursor ?? null;

    if (!fetchAll || hasMore !== true || !pageCursor) break;
    if (pages >= maxPages || now() - started >= timeBudgetMs) break;
  }

  // Tronque : fetch_all s'est arrete alors que l'API annonce encore des
  // elements.
  const truncated = fetchAll && hasMore === true;
  const envelope = {
    items,
    count: items.length,
    has_more: hasMore,
    next_cursor: pageCursor,
    truncated,
  };
  if (sizeCapped) {
    envelope.message = `fetch_all interrompu après ${pages} page(s) : la suite dépasserait ${maxChars.toLocaleString('fr-FR')} caractères, trop pour être exploitée par un modèle. La liste est incomplète. Resserrer les filtres (période plus courte), utiliser pennylane_get_trial_balance pour des soldes par compte, ou l'export FEC (pennylane_export_fec) pour l'intégralité des écritures.`;
  } else if (truncated) {
    envelope.message = pageCursor
      ? `fetch_all interrompu après ${pages} page(s) (plafond : ${maxPages} pages ou ${timeBudgetMs / 1000} s) : la liste est incomplète. Rappeler l'outil avec les mêmes filtres et cursor = next_cursor pour lire la suite.`
      : `fetch_all interrompu après ${pages} page(s) : l'API annonce d'autres éléments sans fournir de curseur. La liste est incomplète.`;
  }
  return envelope;
}
