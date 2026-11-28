import { describe, expect, it } from 'vitest';
import { isSlashCommand, slashCommands } from '../../src/shared/types';

describe('slash commands', () => {
  it('recognizes "/name args" but not paths or plain text', () => {
    expect(isSlashCommand('/goal finish the audit')).toBe(true);
    expect(isSlashCommand('  /compact  ')).toBe(true);
    expect(isSlashCommand('/review:security')).toBe(true);
    expect(isSlashCommand('/home/ys/BrandConcept is the folder')).toBe(false);
    expect(isSlashCommand('please run /compact')).toBe(false);
    expect(isSlashCommand('/')).toBe(false);
    expect(isSlashCommand('/ goal')).toBe(false);
  });

  it('normalizes a CLI command list', () => {
    expect(slashCommands([
      { name: '/goal', description: ' Run until done ', hint: 'goal' },
      { name: 'goal', description: 'duplicate' },
      { name: 'two words' },
      { name: '' },
      { name: 42 },
      { name: 'compact' },
    ])).toEqual([
      { name: 'goal', description: 'Run until done', hint: 'goal' },
      { name: 'compact' },
    ]);
  });
});
