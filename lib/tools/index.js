// Boite a outils MCP : definitions pour tools/list et execution pour
// tools/call. Les arguments sont valides contre le schema de l'outil avant
// tout appel ; les erreurs sont rendues actionnables.

import { callOperation, getOperation, ParameterError } from '../operations.js';
import { DerivationError } from '../derivations.js';
import { validate } from '../validate.js';
import { createLevel1 } from './level1.js';

export function createToolbox({ pennylane, now }) {
  const level1 = createLevel1({ pennylane, now });
  const levels = [level1];
  const definitions = levels.flatMap(level => level.definitions);

  // Un 403 s'explique par les scopes reels du token, lus sur /me : aucun
  // scope manquant n'est predit.
  async function tokenScopes() {
    try {
      const me = await callOperation(pennylane, getOperation('getMe'), {});
      return (me.scopes ?? []).join(', ') || 'aucun';
    } catch {
      return 'illisibles';
    }
  }

  async function explain(error) {
    if (error instanceof ParameterError || error instanceof DerivationError) return error.message;
    if (error.status === 403) return `${error.message} — Scopes réels du token : ${await tokenScopes()}.`;
    if (error.status === 404) {
      return `${error.message} — Ressource ou chemin introuvable : vérifier l'identifiant, ou chercher l'opération voulue avec pennylane_search_operations.`;
    }
    return error.message;
  }

  return {
    definitions,

    // { text, isError } : text est le contenu MCP a renvoyer.
    async call(name, args = {}) {
      console.log(`[MCP] Tool: ${name}`);
      const level = levels.find(candidate => candidate.has(name));
      try {
        if (!level) throw new ParameterError(`Outil inconnu : ${name}`);
        const errors = validate(args, level.schemaOf(name));
        if (errors.length > 0) throw new ParameterError(`${name} : ${errors.join(' ; ')}`);
        const result = await level.run(name, args);
        return { text: typeof result === 'string' ? result : JSON.stringify(result), isError: false };
      } catch (error) {
        console.error(`[MCP] Tool error: ${name}: ${error.message}`);
        return {
          text: JSON.stringify({ error: true, tool: name, message: await explain(error) }),
          isError: true,
        };
      }
    },
  };
}
