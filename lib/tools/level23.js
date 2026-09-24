// Niveaux 2 et 3 : acces aux operations de l'API qui n'ont pas d'outil
// explicite, par le registre. Recherche, description, puis appel valide
// contre le registre avant tout appel HTTP.

import { callOperation, getOperation, ParameterError, REGISTRY } from '../operations.js';
import { annotationsFor } from './level1.js';
import { isExcluded, WRITE_OPERATION_IDS, WRITE_WHITELIST } from './write-whitelist.js';

export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 25;

// Les resumes de la spec sont en anglais : quelques termes francais courants
// y sont ramenes.
const SYNONYMS = {
  facture: 'invoice', factures: 'invoices', avoir: 'credit note', fournisseur: 'supplier',
  fournisseurs: 'suppliers', client: 'customer', clients: 'customers', devis: 'quote',
  ecriture: 'ledger entry', ecritures: 'ledger entries', ligne: 'line', lignes: 'lines',
  compte: 'account', comptes: 'accounts', banque: 'bank', bancaire: 'bank',
  categorie: 'category', categories: 'categories', groupe: 'group', piece: 'attachment',
  jointe: 'attachment', annexe: 'appendix', annexes: 'appendices', mandat: 'mandate',
  abonnement: 'subscription', produit: 'product', produits: 'products', exercice: 'fiscal year',
  balance: 'trial balance', paiement: 'payment', paiements: 'payments', rapprochement: 'matched',
  lettrage: 'lettering', contact: 'contact', modele: 'template', achat: 'purchase',
  demande: 'request', historique: 'changelog', modification: 'changes', export: 'export',
};

const normalize = text => String(text ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '');

function terms(query) {
  return normalize(query)
    .split(/[^a-z0-9]+/)
    .filter(term => term.length >= 2)
    .flatMap(term => (SYNONYMS[term] ? [term, ...SYNONYMS[term].split(' ')] : [term]));
}

const searchable = () => Object.values(REGISTRY.operations).filter(op => !isExcluded(op));

function score(operation, queryTerms) {
  const fields = [
    [normalize(operation.operation_id), 3],
    [normalize(operation.summary), 3],
    [normalize(operation.path), 2],
    [normalize(operation.tags.join(' ')), 2],
    [normalize(operation.description), 1],
  ];
  let total = 0;
  for (const term of queryTerms) {
    for (const [text, weight] of fields) {
      if (text.includes(term)) total += weight;
    }
  }
  return total;
}

function access(operation) {
  if (operation.method === 'GET') return { callable: true, reason: 'lecture' };
  if (!WRITE_OPERATION_IDS.has(operation.operation_id)) {
    return { callable: false, reason: 'écriture hors de la liste blanche' };
  }
  if (operation.request_body && operation.request_body.content_type !== 'application/json') {
    return { callable: false, reason: `envoi de fichier (${operation.request_body.content_type}) non pris en charge à ce jour` };
  }
  return { callable: true, reason: 'écriture de la liste blanche' };
}

const DEFINITIONS = [
  {
    name: 'pennylane_search_operations',
    description: 'Chercher parmi les opérations de l\'API Pennylane celles qu\'aucun outil ne couvre. Renvoie operation_id, méthode, chemin, résumé et scopes documentés (à titre indicatif), sans les schémas : les obtenir ensuite avec pennylane_describe_operation.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Mots-clés, en français ou en anglais' },
        limit: { type: 'integer', minimum: 1, maximum: SEARCH_MAX_LIMIT, description: `Nombre de résultats (${SEARCH_DEFAULT_LIMIT} par défaut)` },
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: annotationsFor('GET'),
  },
  {
    name: 'pennylane_describe_operation',
    description: 'Décrire une opération du registre : paramètres typés, corps, réponse, scopes documentés, et si pennylane_call_operation peut l\'appeler.',
    inputSchema: {
      type: 'object',
      properties: { operation_id: { type: 'string' } },
      required: ['operation_id'],
      additionalProperties: false,
    },
    annotations: annotationsFor('GET'),
  },
  {
    name: 'pennylane_call_operation',
    description: 'Appeler une opération du registre. Paramètres validés contre le registre avant l\'appel : un paramètre inconnu ou mal typé produit une erreur, rien n\'est envoyé. Lectures libres ; écritures limitées à la liste blanche (catégories, clients, devis, pièces jointes, exports), jamais sur les transactions ni les écritures comptables. Réponse relayée telle quelle.',
    inputSchema: {
      type: 'object',
      properties: {
        operation_id: { type: 'string' },
        path_params: { type: 'object', description: 'Paramètres de chemin', additionalProperties: true },
        query: { type: 'object', description: 'Paramètres de requête', additionalProperties: true },
        body: { type: 'object', description: 'Corps JSON', additionalProperties: true },
      },
      required: ['operation_id'],
      additionalProperties: false,
    },
    annotations: { ...annotationsFor('POST'), readOnlyHint: false },
  },
];

function findOperation(operationId) {
  const operation = getOperation(operationId);
  if (!operation) {
    throw new ParameterError(`Opération inconnue : ${operationId}. La chercher avec pennylane_search_operations.`);
  }
  if (isExcluded(operation)) {
    throw new ParameterError(`${operationId} : abonnements webhook exclus tant que le récepteur n'existe pas.`);
  }
  return operation;
}

export function createLevel23({ pennylane }) {
  const handlers = {
    pennylane_search_operations({ query, limit = SEARCH_DEFAULT_LIMIT }) {
      const queryTerms = terms(query);
      return searchable()
        .map(operation => ({ operation, score: score(operation, queryTerms) }))
        .filter(result => result.score > 0)
        .sort((a, b) => b.score - a.score || a.operation.operation_id.localeCompare(b.operation.operation_id))
        .slice(0, limit)
        .map(({ operation }) => ({
          operation_id: operation.operation_id,
          method: operation.method,
          path: operation.path,
          summary: operation.summary,
          scopes: operation.scopes,
        }));
    },

    pennylane_describe_operation({ operation_id }) {
      const operation = findOperation(operation_id);
      return { ...operation, ...access(operation) };
    },

    async pennylane_call_operation({ operation_id, path_params = {}, query = {}, body }) {
      const operation = findOperation(operation_id);
      const { callable, reason } = access(operation);
      if (!callable) {
        const allowed = Object.keys(WRITE_WHITELIST).join(' ; ');
        throw new ParameterError(`${operation_id} refusée : ${reason}. Écritures autorisées : ${allowed}.`);
      }
      return callOperation(pennylane, operation, { pathParams: path_params, query, body });
    },
  };

  return {
    definitions: DEFINITIONS,
    has: name => Object.hasOwn(handlers, name),
    schemaOf: name => DEFINITIONS.find(definition => definition.name === name).inputSchema,
    run: (name, args) => handlers[name](args),
  };
}
