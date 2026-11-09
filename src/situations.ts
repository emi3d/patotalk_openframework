import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Situation } from './types.js';
import { loadSchema, parseSituation } from './validate.js';

export function loadSituations(dir?: string): Situation[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = dir
    ? [dir]
    : [
        join(process.cwd(), 'situations', 'modules'),
        join(process.cwd(), '..', 'situations', 'modules'),
        join(here, 'situations', 'modules'),
        join(here, '..', 'situations', 'modules'),
        join(here, '..', '..', 'situations', 'modules'),
      ];
  const modulesDir = candidates.find((c) => existsSync(c));
  if (!modulesDir) throw new Error(`situations/modules not found (tried: ${candidates.join(', ')})`);
  const schema = loadSchema(join(dirname(modulesDir), 'schema.json'));
  const files = readdirSync(modulesDir).filter((f) => f.endsWith('.json')).sort();
  return files.map((f) => parseSituation(JSON.parse(readFileSync(join(modulesDir, f), 'utf-8')), schema));
}
