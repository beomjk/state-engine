import type { SchemaDefinition } from './define.js';

export interface DocGeneratorOptions {
  /** Which tables to generate. */
  tables: ('statuses' | 'transitions' | 'manual-transitions')[];
}

/**
 * Generate Markdown table strings from a schema definition.
 * Returns a record of table name → markdown string.
 */
export function generateDocs(
  schema: SchemaDefinition<readonly string[]>,
  options?: DocGeneratorOptions,
): Record<string, string> {
  const tables = options?.tables ?? ['statuses', 'transitions', 'manual-transitions'];
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
          const conds = (t.conditions ?? [])
            .map((c) => {
              const argsStr = Object.entries(c.args)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ');
              return `${c.fn}(${argsStr})`;
            })
            .join(', ');
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

    const before = result.slice(0, startIdx + startMarker.length);
    const after = result.slice(endIdx);

    result = `${before}\n${markdown}\n${after}`;
    tablesReplaced.push(name);
  }

  return { content: result, updated: tablesReplaced.length > 0, tablesReplaced };
}
