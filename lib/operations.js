// Appel d'une operation du registre : construction de la requete et
// validation des parametres avant tout appel HTTP. Utilise par les outils de
// niveau 1 et par pennylane_call_operation.

import registry from './registry.json' with { type: 'json' };
import { validate } from './validate.js';

export const REGISTRY = registry;

export class ParameterError extends Error {}

export function getOperation(operationId) {
  return registry.operations[operationId] ?? null;
}

const describeParams = params => params.map(p => `${p.name}${p.required ? ' (requis)' : ''}`).join(', ') || 'aucun';

// Un parametre de chemin finit dans l'URL : sa forme ecrite compte, pas son
// type JSON. Un identifiant entier peut arriver en nombre ou en chaine.
function pathValueErrors(param, value) {
  const text = String(value);
  if (value === undefined || value === null || text === '') return [`${param.name} requis`];
  if (param.schema?.type === 'integer' && !/^\d+$/.test(text)) return [`${param.name} : entier attendu`];
  return [];
}

// Requete prete a envoyer : chemin aux parametres encodes, requete, corps.
// Toute erreur leve ParameterError en citant les parametres attendus ; aucun
// appel ne part.
export function buildRequest(operation, { pathParams = {}, query = {}, body } = {}) {
  const errors = [];
  const pathDefs = operation.parameters.filter(p => p.in === 'path');
  const queryDefs = operation.parameters.filter(p => p.in === 'query');

  for (const name of Object.keys(pathParams)) {
    if (!pathDefs.some(p => p.name === name)) {
      errors.push(`parametre de chemin inconnu ${name} ; attendus : ${describeParams(pathDefs)}`);
    }
  }
  let path = operation.path;
  for (const param of pathDefs) {
    const value = pathParams[param.name];
    const problems = pathValueErrors(param, value);
    errors.push(...problems);
    if (problems.length === 0) path = path.replace(`{${param.name}}`, encodeURIComponent(String(value)));
  }

  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value === undefined) continue;
    const param = queryDefs.find(p => p.name === name);
    if (!param) {
      errors.push(`parametre de requete inconnu ${name} ; attendus : ${describeParams(queryDefs)}`);
      continue;
    }
    errors.push(...validate(value, param.schema, name));
    search.set(name, typeof value === 'string' ? value : JSON.stringify(value));
  }
  for (const param of queryDefs) {
    if (param.required && query[param.name] === undefined) errors.push(`${param.name} requis`);
  }

  const bodyDef = operation.request_body;
  if (body !== undefined && !bodyDef) {
    errors.push(`${operation.operation_id} n'accepte pas de corps`);
  } else if (bodyDef) {
    if (body === undefined) {
      if (bodyDef.required) errors.push('corps requis');
    } else if (bodyDef.content_type !== 'application/json') {
      errors.push(`corps ${bodyDef.content_type} : envoi de fichier non pris en charge`);
    } else {
      errors.push(...validate(body, bodyDef.schema, 'corps'));
    }
  }

  if (errors.length > 0) {
    throw new ParameterError(`${operation.operation_id} : ${errors.join(' ; ')}`);
  }
  const queryString = search.toString();
  return { endpoint: `${path}${queryString ? `?${queryString}` : ''}`, method: operation.method, body };
}

export async function callOperation(pennylane, operation, request) {
  const { endpoint, method, body } = buildRequest(operation, request);
  return pennylane(endpoint, { method, body });
}
