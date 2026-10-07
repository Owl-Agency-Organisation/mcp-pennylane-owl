// Validation d'arguments contre un schema du registre, avant tout appel HTTP.
// Sous-ensemble de JSON Schema, sans dependance : types, enum, required,
// proprietes, elements, formats date et date-time, bornes, oneOf/anyOf/allOf.
//
// Plus strict que JSON Schema sur un point : une propriete inconnue est une
// erreur, sauf si le schema autorise explicitement les proprietes
// additionnelles. Un argument mal nomme ne part jamais vers l'API.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function typeMatches(value, type) {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
}

const at = path => (path ? `${path} : ` : '');

export function validate(value, schema, path = '') {
  if (!schema || typeof schema !== 'object') return [];

  // Les combinaisons passent avant le controle de null : une branche peut
  // accepter null (enum [null], nullable).
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.flatMap(sub => validate(value, sub, path));
  }
  for (const key of ['oneOf', 'anyOf']) {
    if (Array.isArray(schema[key])) {
      const branches = schema[key].map(sub => validate(value, sub, path));
      if (branches.some(errors => errors.length === 0)) return [];
      // Branche la plus proche : celle qui produit le moins d'erreurs.
      return branches.sort((a, b) => a.length - b.length)[0];
    }
  }

  if (value === null) {
    const accepted = schema.nullable || schema.type === 'null' || (Array.isArray(schema.enum) && schema.enum.includes(null));
    return accepted ? [] : [`${at(path)}null non accepte`];
  }

  const errors = [];
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length > 0 && !types.some(type => typeMatches(value, type))) {
    return [`${at(path)}${types.join(' ou ')} attendu, ${typeOf(value)} recu`];
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${at(path)}valeurs acceptees : ${schema.enum.map(v => JSON.stringify(v)).join(', ')}`);
  }

  if (typeof value === 'string') {
    if (schema.format === 'date' && !DATE.test(value)) errors.push(`${at(path)}date YYYY-MM-DD attendue`);
    if (schema.format === 'date-time' && !DATE_TIME.test(value)) errors.push(`${at(path)}date-heure RFC 3339 attendue`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at(path)}${schema.minLength} caracteres au moins`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at(path)}${schema.maxLength} caracteres au plus`);
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at(path)}minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at(path)}maximum ${schema.maximum}`);
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => errors.push(...validate(item, schema.items, `${path}[${index}]`)));
  }

  if (typeOf(value) === 'object' && (schema.properties || schema.required || schema.additionalProperties === false)) {
    const properties = schema.properties ?? {};
    for (const name of schema.required ?? []) {
      if (value[name] === undefined) errors.push(`${at(path)}${name} requis`);
    }
    for (const [name, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${name}` : name;
      if (properties[name]) {
        if (child !== undefined) errors.push(...validate(child, properties[name], childPath));
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        errors.push(...validate(child, schema.additionalProperties, childPath));
      } else if (schema.additionalProperties !== true) {
        const expected = Object.keys(properties);
        errors.push(`${at(path)}parametre inconnu ${name} ; attendus : ${expected.length ? expected.join(', ') : 'aucun'}`);
      }
    }
  }

  return errors;
}
