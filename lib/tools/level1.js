// Outils de niveau 1 construits sur le registre : schemas d'entree issus des
// parametres et corps documentes, relais fins vers l'operation. Toute
// derivation passe par lib/derivations.js.

import { callOperation, getOperation } from '../operations.js';
import { paginate, FETCH_ALL_MAX_CHARS, FETCH_ALL_MAX_PAGES, FETCH_ALL_TIME_BUDGET_MS } from '../pagination.js';
import { currentFiscalYear, lineBalance, parisDate, resolveFiscalPeriod } from '../derivations.js';
import { envelopeToMarkdown } from '../format.js';
import { ParameterError } from '../operations.js';
import { LEVEL1_SPECS } from './level1-specs.js';

// Parametres de requete geres par l'enveloppe de pagination ou par la
// commodite de filtre par date, jamais exposes tels quels au niveau 1.
const MANAGED_QUERY = ['cursor', 'limit', 'filter', 'sort', 'include'];

// Au-dela, le corps d'une ecriture n'est pas deplie dans tools/list : il
// peserait sur chaque requete du modele. Il reste valide contre le registre.
export const INLINE_BODY_MAX = 2_000;

const DESCRIPTION_MAX = 120;
const short = text => (text && text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX - 1)}…` : text);

export function annotationsFor(method) {
  return {
    readOnlyHint: method === 'GET',
    destructiveHint: method === 'DELETE',
    idempotentHint: method !== 'POST',
    openWorldHint: true,
  };
}

const RESPONSE_FORMAT = {
  type: 'string',
  enum: ['markdown', 'json'],
  description: 'markdown (défaut) : une ligne par élément, champs vides omis ; json : réponse complète',
};

const DATE_FILTER = {
  start_date: { type: 'string', format: 'date', description: 'Date de début (YYYY-MM-DD)' },
  end_date: { type: 'string', format: 'date', description: 'Date de fin (YYYY-MM-DD)' },
};

function paginationProperties(operation) {
  const max = operation.parameters.find(p => p.name === 'limit')?.schema?.maximum ?? 100;
  return {
    limit: { type: 'number', description: `Taille de page, 1 à ${max} (50 par défaut)` },
    cursor: { type: 'string', description: 'next_cursor d\'une réponse précédente ; renvoyer les mêmes filtres' },
    fetch_all: {
      type: 'boolean',
      description: `Lire les pages suivantes (au plus ${FETCH_ALL_MAX_PAGES} pages, ${FETCH_ALL_TIME_BUDGET_MS / 1000} s, ${FETCH_ALL_MAX_CHARS.toLocaleString('fr-FR')} caractères) ; sinon truncated = true et next_cursor pour reprendre`,
    },
  };
}

const paramProperty = param => ({ ...param.schema, ...(param.description ? { description: short(param.description) } : {}) });

// Schema d'entree et plan d'appel d'un outil declare dans LEVEL1_SPECS.
function buildTool(spec) {
  if (spec.kind === 'custom') return { spec, inputSchema: customInputSchema(spec.name) };

  const operation = getOperation(spec.operation);
  if (!operation) throw new Error(`${spec.name} : operation ${spec.operation} absente du registre`);

  const properties = {};
  const required = [];
  const pathParams = operation.parameters.filter(p => p.in === 'path');
  for (const param of pathParams) {
    properties[param.name] = paramProperty(param);
    required.push(param.name);
  }

  let queryParams = [];
  let paginated = false;
  let inlineBody = false;

  if (spec.kind === 'list') {
    queryParams = operation.parameters.filter(p => p.in === 'query' && !MANAGED_QUERY.includes(p.name));
    for (const param of queryParams) {
      properties[param.name] = paramProperty(param);
      if (param.required) required.push(param.name);
    }
    if (spec.dateFilter) Object.assign(properties, DATE_FILTER);
    paginated = operation.parameters.some(p => p.name === 'cursor');
    if (paginated) Object.assign(properties, paginationProperties(operation));
    properties.response_format = RESPONSE_FORMAT;
  }

  if (spec.kind === 'write' && operation.request_body) {
    const schema = operation.request_body.schema;
    inlineBody = JSON.stringify(schema).length <= INLINE_BODY_MAX && schema.properties
      && !Object.keys(schema.properties).some(name => properties[name]);
    if (inlineBody) {
      Object.assign(properties, schema.properties);
      required.push(...(schema.required ?? []));
    } else {
      properties.body = {
        type: 'object',
        description: `Corps de l'opération ${operation.operation_id} : schéma complet via pennylane_describe_operation. Validé avant l'appel.`,
      };
      if (operation.request_body.required) required.push('body');
    }
  }

  return {
    spec,
    operation,
    pathNames: pathParams.map(p => p.name),
    queryNames: queryParams.map(p => p.name),
    paginated,
    inlineBody,
    inputSchema: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    },
  };
}

function customInputSchema(name) {
  if (name === 'pennylane_resolve_fiscal_period') {
    return {
      type: 'object',
      properties: {
        fiscal_year: {
          type: ['string', 'integer'],
          description: '"current" (défaut) ou identifiant d\'exercice',
        },
      },
      additionalProperties: false,
    };
  }
  return { type: 'object', properties: {}, additionalProperties: false };
}

const pick = (args, names) => Object.fromEntries(names.filter(n => args[n] !== undefined).map(n => [n, args[n]]));
const omit = (args, names) => Object.fromEntries(Object.entries(args).filter(([n]) => !names.includes(n)));

// Taille de page : bornee au maximum documente par l'operation, 50 par defaut.
function pageSize(limit, operation) {
  const max = operation.parameters.find(p => p.name === 'limit')?.schema?.maximum ?? 100;
  if (limit === undefined) return Math.min(50, max);
  return Math.min(max, Math.max(1, Math.floor(limit)));
}

function dateFilters({ start_date, end_date }) {
  const filters = [];
  if (start_date) filters.push({ field: 'date', operator: 'gteq', value: start_date });
  if (end_date) filters.push({ field: 'date', operator: 'lteq', value: end_date });
  return filters;
}

const DERIVATIONS = {
  lineBalance: line => ({ ...line, balance: lineBalance(line) }),
};

export function createLevel1({ pennylane, now = () => new Date() }) {
  const tools = LEVEL1_SPECS.map(buildTool);
  const byName = new Map(tools.map(tool => [tool.spec.name, tool]));

  const call = (operationId, request = {}) => callOperation(pennylane, getOperation(operationId), request);

  async function allFiscalYears() {
    const envelope = await paginate(
      cursor => call('company-fiscal-years', { query: { limit: 100, ...(cursor ? { cursor } : {}) } }),
      { fetchAll: true },
    );
    return envelope.items;
  }

  const custom = {
    async pennylane_health_check() {
      const me = await call('getMe');
      const fiscalYears = await allFiscalYears();
      const transactions = (await call('getTransactions', { query: { limit: 5 } })).items ?? [];
      return {
        status: 'ok',
        timestamp: now().toISOString(),
        connection: {
          user: { email: me.user?.email, company: me.company?.name },
          scopes: me.scopes ?? [],
        },
        fiscalYears: {
          total: fiscalYears.length,
          current: currentFiscalYear(fiscalYears, parisDate(now())),
        },
        recentActivity: {
          lastTransactions: transactions.length,
          lastTransactionDate: transactions[0]?.date,
        },
      };
    },

    async pennylane_resolve_fiscal_period(args) {
      return resolveFiscalPeriod(await allFiscalYears(), args.fiscal_year ?? 'current', parisDate(now()));
    },
  };

  async function runList(tool, args) {
    const { spec, operation } = tool;
    const firstPageOnly = spec.firstPageOnly ?? [];
    for (const name of firstPageOnly) {
      if (args[name] !== undefined && args.cursor !== undefined) {
        throw new ParameterError(`${name} ne se combine pas avec cursor`);
      }
    }

    const pathParams = pick(args, tool.pathNames);
    const persistent = pick(args, tool.queryNames.filter(n => !firstPageOnly.includes(n)));
    const firstPage = pick(args, firstPageOnly);
    const filters = spec.dateFilter ? dateFilters(args) : [];
    const baseQuery = {
      ...persistent,
      ...(tool.paginated ? { limit: pageSize(args.limit, operation) } : {}),
      ...(filters.length > 0 ? { filter: JSON.stringify(filters) } : {}),
    };

    const envelope = await paginate(
      cursor => call(spec.operation, {
        pathParams,
        query: { ...baseQuery, ...(cursor ? { cursor } : firstPage) },
      }),
      { cursor: args.cursor ?? null, fetchAll: tool.paginated && args.fetch_all === true },
    );
    if (spec.derive) envelope.items = envelope.items.map(DERIVATIONS[spec.derive]);
    return envelope;
  }

  async function run(tool, args) {
    const { spec } = tool;
    if (spec.kind === 'custom') return custom[spec.name](args);
    if (spec.kind === 'get') return call(spec.operation, { pathParams: pick(args, tool.pathNames) });
    if (spec.kind === 'list') return runList(tool, args);
    // write
    const body = tool.inlineBody ? omit(args, tool.pathNames) : args.body;
    return call(spec.operation, { pathParams: pick(args, tool.pathNames), body });
  }

  return {
    definitions: tools.map(tool => ({
      name: tool.spec.name,
      description: tool.spec.description,
      inputSchema: tool.inputSchema,
      annotations: annotationsFor(tool.spec.method ?? tool.operation.method),
    })),
    has: name => byName.has(name),
    schemaOf: name => byName.get(name).inputSchema,
    // Resultat pret a serialiser : texte markdown pour une liste par defaut,
    // sinon objet JSON.
    async run(name, args) {
      const tool = byName.get(name);
      const result = await run(tool, args);
      if (tool.spec.kind === 'list' && args.response_format !== 'json') return envelopeToMarkdown(result);
      return result;
    },
  };
}
