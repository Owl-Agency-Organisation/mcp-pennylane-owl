// Metadonnees du serveur d'autorisation (RFC 8414).

import { oauthFromEnv } from '../../../lib/oauth/env.js';

export const dynamic = 'force-dynamic';

const oauth = oauthFromEnv();

export async function GET() {
  if (!oauth) return Response.json({ error: 'oauth_not_configured' }, { status: 404 });
  return Response.json(oauth.authorizationServerMetadata());
}
