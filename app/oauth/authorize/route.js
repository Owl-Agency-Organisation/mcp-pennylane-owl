// Point d'autorisation : GET affiche le consentement, POST le traite.

import { oauthFromEnv } from '../../../lib/oauth/env.js';

export const dynamic = 'force-dynamic';

const oauth = oauthFromEnv();

const notConfigured = () => Response.json({ error: 'oauth_not_configured' }, { status: 404 });

export async function GET(request) {
  return oauth ? oauth.handleAuthorizeGet(request) : notConfigured();
}

export async function POST(request) {
  return oauth ? oauth.handleAuthorizePost(request) : notConfigured();
}
