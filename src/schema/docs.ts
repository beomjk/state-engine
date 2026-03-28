import type { EntityDefinition, SchemaDefinition } from './define.js';

export interface DocGeneratorOptions {
  /**
   * Which tables to generate.
   * Available: 'statuses', 'transitions', 'manual-transitions', 'relations'.
   * Defaults to all four when omitted.
   */
  tables: ('statuses' | 'transitions' | 'manual-transitions' | 'relations')[];
}

/** Format a condition as `fn(key=value, ...)`. */
function formatCondition(c: { fn: string; args: Record<string, unknown> }): string {
  const argsStr = Object.entries(c.args)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return `${c.fn}(${argsStr})`;
}

/**
 * Generate Markdown table strings from a schema definition.
 * Returns a record of table name → markdown string.
 *
 * When `options.tables` is omitted, all four tables are generated
 * (statuses, transitions, manual-transitions, relations).
 */
export function generateDocs(
  schema: SchemaDefinition<readonly string[]>,
  options?: DocGeneratorOptions,
): Record<string, string> {
  const defaultTables: typeof tables = ['statuses', 'transitions', 'manual-transitions'];
  if (schema.relations?.length) defaultTables.push('relations');
  const tables = options?.tables ?? defaultTables;
  const result: Record<string, string> = {};

  for (const table of tables) {
    const lines: string[] = [];

    for (const [, entity] of Object.entries(schema.entities)) {
      if (table === 'statuses') {
        lines.push(`**${entity.name}**`);
        lines.push('| Status |');
        lines.push('|--------|');
        for (const status of entity.statuses) {
          lines.push(`| ${status} |`);
        }
        lines.push('');
      }

      if (table === 'transitions' && entity.transitions?.length) {
        lines.push(`**${entity.name}**`);
        lines.push('| From | To | Conditions |');
        lines.push('|------|----|------------|');
        for (const t of entity.transitions) {
          const conds = (t.conditions ?? []).map(formatCondition).join(', ');
          lines.push(`| ${t.from} | ${t.to} | ${conds || '—'} |`);
        }
        lines.push('');
      }

      if (table === 'manual-transitions' && entity.manualTransitions?.length) {
        lines.push(`**${entity.name}**`);
        lines.push('| From | To |');
        lines.push('|------|----|');
        for (const mt of entity.manualTransitions) {
          lines.push(`| ${mt.from} | ${mt.to} |`);
        }
        lines.push('');
      }
    }

    // Relations are schema-level (not per-entity), so rendered outside the entity loop
    if (table === 'relations' && schema.relations?.length) {
      lines.push('| Relation | Source | Target | Direction | Metadata |');
      lines.push('|----------|--------|--------|-----------|----------|');
      for (const rel of schema.relations) {
        const direction = rel.direction ?? 'default';
        const metadata = rel.metadata ? JSON.stringify(rel.metadata) : '\u2014';
        lines.push(`| ${rel.name} | ${rel.source} | ${rel.target} | ${direction} | ${metadata} |`);
      }
      lines.push('');
    }

    result[table] = lines.join('\n');
  }

  return result;
}

/**
 * Update AUTO marker regions in a Markdown file content.
 * Markers: <!-- AUTO:{name} --> ... <!-- /AUTO:{name} -->
 */
export function updateDocContent(
  content: string,
  schema: SchemaDefinition<readonly string[]>,
  options?: DocGeneratorOptions,
): { content: string; updated: boolean; tablesReplaced: string[] } {
  const docs = generateDocs(schema, options);
  const tablesReplaced: string[] = [];
  let result = content;

  for (const [name, markdown] of Object.entries(docs)) {
    const startMarker = `<!-- AUTO:${name} -->`;
    const endMarker = `<!-- /AUTO:${name} -->`;

    const startIdx = result.indexOf(startMarker);
    const endIdx = result.indexOf(endMarker);

    if (startIdx === -1 || endIdx === -1) continue;
    if (startIdx >= endIdx) continue;

    const before = result.slice(0, startIdx + startMarker.length);
    const after = result.slice(endIdx);

    result = `${before}\n${markdown}\n${after}`;
    tablesReplaced.push(name);
  }

  return { content: result, updated: tablesReplaced.length > 0, tablesReplaced };
}

/**
 * Generate a Mermaid stateDiagram-v2 string from an entity definition.
 *
 * - First status in the tuple is treated as the initial state.
 * - Auto transitions are labeled with their conditions.
 * - Manual transitions are labeled "manual". ANY wildcards are expanded
 *   to all statuses (excluding the target to avoid trivial self-loops).
 */
export function generateMermaid(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entity: EntityDefinition<readonly string[], readonly string[], any>,
): string {
  const lines: string[] = ['stateDiagram-v2'];

  // Initial state → first status
  lines.push(`    [*] --> ${entity.statuses[0]}`);

  // Auto transitions
  if (entity.transitions) {
    for (const t of entity.transitions) {
      const label = (t.conditions ?? []).map(formatCondition).join(' AND ');
      lines.push(`    ${t.from} --> ${t.to}${label ? `: ${label}` : ''}`);
    }
  }

  // Manual transitions (expand ANY wildcard)
  if (entity.manualTransitions) {
    for (const mt of entity.manualTransitions) {
      if (mt.from === 'ANY') {
        for (const status of entity.statuses) {
          if (status !== mt.to) {
            lines.push(`    ${status} --> ${mt.to}: manual`);
          }
        }
      } else {
        lines.push(`    ${mt.from} --> ${mt.to}: manual`);
      }
    }
  }

  return lines.join('\n');
}
