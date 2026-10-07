// Operations de l'API appelees par les outils de niveau 1. Le build echoue si
// l'une d'elles disparait de la spec : scripts/generate-registry.mjs --check,
// lance avant chaque build. La liste se deduit des declarations d'outils.
export { LEVEL1_OPERATION_IDS } from './tools/level1-specs.js';
