// Construction du registre des operations depuis la spec OpenAPI de la
// Company API v2. Fonctions pures : scripts/generate-registry.mjs les
// orchestre, les tests les appellent directement.

import { createHash } from 'node:crypto';

export const API_PREFIX = '/api/external/v2';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// Mots-cles de schema conserves. Les exemples et extensions sont ecartes :
// ils alourdissent le registre sans servir a valider.
const SCHEMA_KEYS = [
  'type', 'format', 'enum', 'nullable', 'description', 'default',
  'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'minItems', 'maxItems',
];

const DESCRIPTION_MAX = 300;
// Profondeur des schemas de reponse : de quoi comprendre la forme renvoyee,
// sans recopier des arbres de plusieurs niveaux d'objets imbriques.
const RESPONSE_MAX_DEPTH = 3;

const trim = text => {
  if (typeof text !== 'string') return undefined;
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > DESCRIPTION_MAX ? `${clean.slice(0, DESCRIPTION_MAX - 1)}…` : clean;
};

// Schema simplifie : mots-cles utiles a la validation et a la description,
// descriptions resserrees. Au-dela de maxDepth, seul le type subsiste.
export function simplifySchema(schema, maxDepth = Infinity, depth = 0) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const key of SCHEMA_KEYS) {
    if (schema[key] !== undefined) out[key] = key === 'description' ? trim(schema[key]) : schema[key];
  }
  if (depth >= maxDepth) {
    delete out.description;
    return out;
  }
  const next = s => simplifySchema(s, maxDepth, depth + 1);
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, next(v)]));
  }
  if (Array.isArray(schema.required) && schema.required.length > 0) out.required = schema.required;
  if (schema.items) out.items = next(schema.items);
  if (typeof schema.additionalProperties === 'boolean') out.additionalProperties = schema.additionalProperties;
  else if (schema.additionalProperties) out.additionalProperties = next(schema.additionalProperties);
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(schema[key])) out[key] = schema[key].map(next);
  }
  return out;
}

function successResponse(operation) {
  for (const status of ['200', '201', '202']) {
    const content = operation.responses?.[status]?.content;
    if (content?.['application/json']) {
      return { status: Number(status), schema: simplifySchema(content['application/json'].schema, RESPONSE_MAX_DEPTH) };
    }
    if (operation.responses?.[status]) return { status: Number(status), schema: null };
  }
  return null;
}

function requestBody(operation) {
  const body = operation.requestBody;
  if (!body?.content) return null;
  const [contentType, media] = Object.entries(body.content)[0];
  return { content_type: contentType, required: Boolean(body.required), schema: simplifySchema(media.schema) };
}

export function buildRegistry(spec, { source }) {
  const operations = {};
  for (const [rawPath, item] of Object.entries(spec.paths ?? {})) {
    if (!rawPath.startsWith(API_PREFIX)) {
      throw new Error(`Chemin hors de ${API_PREFIX} : ${rawPath}`);
    }
    const path = rawPath.slice(API_PREFIX.length);
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const id = operation.operationId;
      if (!id) throw new Error(`Operation sans operationId : ${method.toUpperCase()} ${rawPath}`);
      if (operations[id]) throw new Error(`operationId en double : ${id}`);

      const parameters = [...(item.parameters ?? []), ...(operation.parameters ?? [])].map(p => ({
        name: p.name,
        in: p.in,
        required: Boolean(p.required || p.in === 'path'),
        description: trim(p.description),
        schema: simplifySchema(p.schema),
      }));

      operations[id] = {
        operation_id: id,
        method: method.toUpperCase(),
        path,
        summary: trim(operation.summary),
        description: trim(operation.description),
        tags: operation.tags ?? [],
        // Scopes tels que documentes, a titre indicatif : aucun controle de
        // droits n'en est deduit.
        scopes: (operation.security ?? []).flatMap(requirement => Object.values(requirement).flat()),
        parameters,
        request_body: requestBody(operation),
        response: successResponse(operation),
      };
    }
  }

  const sorted = Object.fromEntries(Object.keys(operations).sort().map(id => [id, operations[id]]));
  return {
    source,
    spec_version: spec.info?.version ?? null,
    spec_sha256: createHash('sha256').update(JSON.stringify(spec)).digest('hex'),
    operation_count: Object.keys(sorted).length,
    operations: sorted,
  };
}

// Operations du niveau 1 absentes du registre.
export function missingOperations(registry, operationIds) {
  return operationIds.filter(id => !registry.operations[id]);
}

// Une operation par ligne : un diff de PR montre exactement lesquelles
// changent, sans le poids d'un JSON entierement indente.
export function serializeRegistry(registry) {
  const { operations, ...meta } = registry;
  const head = Object.entries(meta).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const ops = Object.entries(operations).map(([id, op]) => `    ${JSON.stringify(id)}: ${JSON.stringify(op)}`);
  return `{\n${head.join(",\n")},\n  "operations": {\n${ops.join(",\n")}\n  }\n}\n`;
}
