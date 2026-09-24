// Rendu des listes en markdown, format par defaut des outils de liste : plus
// compact que le JSON pour le modele. Une ligne par element ; les champs vides
// (null, tableau vide) sont omis, les objets imbriques restent en JSON
// compact. response_format = "json" rend la reponse complete.

function renderValue(value) {
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function renderItem(item) {
  if (item === null || typeof item !== 'object') return renderValue(item);
  return Object.entries(item)
    .filter(([, value]) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0))
    .map(([key, value]) => `${key}: ${renderValue(value)}`)
    .join(' · ');
}

export function envelopeToMarkdown(envelope) {
  const head = [
    `count: ${envelope.count}`,
    `has_more: ${envelope.has_more}`,
    `next_cursor: ${envelope.next_cursor ?? 'null'}`,
    `truncated: ${envelope.truncated}`,
  ].join(' · ');
  const lines = envelope.items.map((item, index) => `${index + 1}. ${renderItem(item)}`);
  return [head, ...(envelope.message ? [`message: ${envelope.message}`] : []), '', ...lines].join('\n');
}
