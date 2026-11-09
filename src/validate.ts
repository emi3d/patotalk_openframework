import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Situation } from './types.js';

export interface ValidationError {
  path: string;
  message: string;
}

export function loadSchema(schemaPath?: string): Record<string, unknown> {
  if (schemaPath) return JSON.parse(readFileSync(schemaPath, 'utf-8')) as Record<string, unknown>;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), 'situations', 'schema.json'),
    join(here, 'situations', 'schema.json'),
    join(here, '..', 'situations', 'schema.json'),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`situations/schema.json not found (tried: ${candidates.join(', ')})`);
  return JSON.parse(readFileSync(found, 'utf-8')) as Record<string, unknown>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateSituation(data: unknown, schema?: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];
  const add = (path: string, message: string) => errors.push({ path, message });
  if (!isObject(data)) {
    add('', 'situation must be an object');
    return errors;
  }
  // Required fields come from the schema file, so the schema stays authoritative.
  const required = (schema?.required as string[] | undefined) ?? [
    'id', 'version', 'title', 'domain', 'language', 'level', 'description',
    'roles', 'systemPrompt', 'objectives', 'rubric', 'maxTurns', 'successCriteria',
  ];
  for (const f of required) {
    if (data[f] === undefined || data[f] === null || data[f] === '') add(f, `missing required field: ${f}`);
  }
  if (typeof data.id === 'string' && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(data.id)) add('id', 'id must be a lowercase slug');
  if (typeof data.version === 'string' && !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(data.version)) add('version', 'version must be semver x.y.z');
  if (typeof data.maxTurns === 'number' && (data.maxTurns < 1 || data.maxTurns > 50)) add('maxTurns', 'maxTurns must be 1-50');

  // Objectives: unique ids, weights sum to ~1.
  if (Array.isArray(data.objectives)) {
    if (data.objectives.length === 0) add('objectives', 'at least one objective is required');
    const ids = new Set<string>();
    let sum = 0;
    for (const [i, o] of data.objectives.entries()) {
      if (!isObject(o)) { add(`objectives[${i}]`, 'objective must be an object'); continue; }
      if (typeof o.id !== 'string') add(`objectives[${i}].id`, 'missing id');
      else if (ids.has(o.id)) add(`objectives[${i}].id`, `duplicate objective id: ${o.id}`);
      else ids.add(o.id);
      if (typeof o.weight === 'number') sum += o.weight;
      else add(`objectives[${i}].weight`, 'weight must be a number');
      if (typeof o.description !== 'string' || !o.description) add(`objectives[${i}].description`, 'missing description');
    }
    if (Math.abs(sum - 1) > 0.01) add('objectives', `objective weights must sum to 1 (got ${sum.toFixed(3)})`);
  } else if (data.objectives !== undefined) {
    add('objectives', 'objectives must be an array');
  }

  // Rubric: unique criterion ids, weights sum to ~1, passThreshold in 0-1.
  if (isObject(data.rubric)) {
    const r = data.rubric;
    if (typeof r.passThreshold !== 'number' || r.passThreshold < 0 || r.passThreshold > 1) {
      add('rubric.passThreshold', 'passThreshold must be a number 0-1');
    }
    if (Array.isArray(r.criteria)) {
      if (r.criteria.length === 0) add('rubric.criteria', 'at least one criterion is required');
      const ids = new Set<string>();
      let sum = 0;
      for (const [i, c] of r.criteria.entries()) {
        if (!isObject(c)) { add(`rubric.criteria[${i}]`, 'criterion must be an object'); continue; }
        if (typeof c.id !== 'string') add(`rubric.criteria[${i}].id`, 'missing id');
        else if (ids.has(c.id)) add(`rubric.criteria[${i}].id`, `duplicate criterion id: ${c.id}`);
        else ids.add(c.id);
        if (typeof c.weight === 'number') sum += c.weight;
        else add(`rubric.criteria[${i}].weight`, 'weight must be a number');
      }
      if (Math.abs(sum - 1) > 0.01) add('rubric.criteria', `criterion weights must sum to 1 (got ${sum.toFixed(3)})`);
    } else {
      add('rubric.criteria', 'rubric.criteria must be an array');
    }
  } else if (data.rubric !== undefined) {
    add('rubric', 'rubric must be an object');
  }

  if (isObject(data.roles)) {
    for (const role of ['user', 'ai']) {
      const r = data.roles[role];
      if (!isObject(r) || typeof r.name !== 'string' || typeof r.description !== 'string') {
        add(`roles.${role}`, `roles.${role} needs name and description`);
      }
    }
  }
  return errors;
}

export function parseSituation(data: unknown, schema?: Record<string, unknown>): Situation {
  const errors = validateSituation(data, schema);
  if (errors.length > 0) {
    throw new Error(`Invalid situation module: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return data as Situation;
}
