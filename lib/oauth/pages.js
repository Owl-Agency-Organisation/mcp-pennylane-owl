// Pages HTML du serveur d'autorisation : consentement et erreur. Aucun
// script, aucune ressource externe.

const escapeHtml = value =>
  String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);

// Aucune ressource externe, aucun cadre : la page ne peut pas etre
// incrustee pour tromper l'utilisateur.
const SECURITY_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

const STYLE = `
  body { font-family: system-ui, sans-serif; max-width: 30rem; margin: 3rem auto; padding: 0 1rem; color: #1f2328; }
  h1 { font-size: 1.3rem; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: .4rem 1rem; }
  dt { color: #59636e; }
  dd { margin: 0; font-weight: 600; word-break: break-all; }
  label { display: block; margin-top: 1.2rem; }
  input[type=password] { width: 100%; padding: .5rem; font-size: 1rem; box-sizing: border-box; }
  .actions { display: flex; gap: .8rem; margin-top: 1.2rem; }
  button { padding: .55rem 1.2rem; font-size: 1rem; cursor: pointer; }
  .error { color: #b3261e; font-weight: 600; }
`;

function page(title, body, status) {
  const html = `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body>${body}</body>
</html>`;
  return new Response(html, { status, headers: SECURITY_HEADERS });
}

export function errorPage(message, status = 400) {
  return page(
    'Autorisation impossible',
    `<h1>Autorisation impossible</h1><p class="error">${escapeHtml(message)}</p>`,
    status,
  );
}

// `params` : parametres de la requete d'autorisation, renvoyes tels quels a
// la soumission et revalides a ce moment.
export function consentPage({ clientName, redirectUri, params, error, status = 200 }) {
  const hidden = Object.entries(params)
    .filter(([, value]) => value)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('\n');
  const host = new URL(redirectUri).host;

  return page(
    'Autoriser l\'accès à Pennylane',
    `<h1>Autoriser l'accès à la comptabilité Pennylane</h1>
<dl>
  <dt>Application</dt><dd>${escapeHtml(clientName)}</dd>
  <dt>Redirection vers</dt><dd>${escapeHtml(host)}</dd>
  <dt>Accès</dt><dd>pennylane</dd>
</dl>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
<form method="post">
${hidden}
<label>Mot de passe du propriétaire
<input type="password" name="password" autocomplete="current-password" autofocus></label>
<div class="actions">
  <button type="submit" name="decision" value="approve">Autoriser</button>
  <button type="submit" name="decision" value="deny">Refuser</button>
</div>
</form>`,
    status,
  );
}
