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
  now = () => Date.now(),
} = {}) {
  const started = now();
  const items = [];
  let pageCursor = cursor || null;
  let hasMore = null;
  let pages = 0;

  for (;;) {
    const page = await fetchPage(pageCursor);
    pages++;
    items.push(...asArray(page, ...itemKeys));
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
  if (truncated) {
    envelope.message = pageCursor
      ? `fetch_all interrompu après ${pages} page(s) (plafond : ${maxPages} pages ou ${timeBudgetMs / 1000} s) : la liste est incomplète. Rappeler l'outil avec les mêmes filtres et cursor = next_cursor pour lire la suite.`
      : `fetch_all interrompu après ${pages} page(s) : l'API annonce d'autres éléments sans fournir de curseur. La liste est incomplète.`;
  }
  return envelope;
}
