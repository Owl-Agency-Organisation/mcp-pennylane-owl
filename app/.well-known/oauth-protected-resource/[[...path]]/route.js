// Metadonnees de ressource protegee (RFC 9728). Servies a la racine et sous
// le chemin de l'endpoint (/.well-known/oauth-protected-resource/api/mcp),
// les deux emplacements que sondent les clients.

import { oauthFromEnv } from '../../../../lib/oauth/env.js';

export const dynamic = 'force-dynamic';

const oauth = oauthFromEnv();

export async function GET() {
  if (!oauth) return Response.json({ error: 'oauth_not_configured' }, { status: 404 });
  return Response.json(oauth.protectedResourceMetadata());
}
