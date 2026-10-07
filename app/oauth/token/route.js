// Point de jeton : echange de code (PKCE) et rotation des refresh tokens.

import { oauthFromEnv } from '../../../lib/oauth/env.js';

export const dynamic = 'force-dynamic';

const oauth = oauthFromEnv();

export async function POST(request) {
  if (!oauth) return Response.json({ error: 'oauth_not_configured' }, { status: 404 });
  return oauth.handleToken(request);
}
