import { describe, expect, it } from 'vitest';

import {
  derivePrefixFromSlug,
  EntityIdError,
  ensureUniquePrefix,
  isValidPrefix,
  normalizePrefix,
  PREFIX_MAX_LENGTH,
  PREFIX_MIN_LENGTH,
  PREFIX_RE,
} from './prefix.js';

describe('normalizePrefix', () => {
  it('trims and lowercases', () => {
    expect(normalizePrefix('  USR ')).toBe('usr');
    expect(normalizePrefix('Ord')).toBe('ord');
  });

  it('allows a conventional prefix that keeps its vowels', () => {
    expect(normalizePrefix('req')).toBe('req');
    expect(normalizePrefix('mem')).toBe('mem');
    expect(normalizePrefix('user')).toBe('user');
  });

  it('allows digits after the first character', () => {
    expect(normalizePrefix('v2doc')).toBe('v2doc');
  });

  it.each([
    ['too short', 'a'],
    ['empty', ''],
    ['leading digit', '1ab'],
    ['underscore', 'a_b'],
    ['hyphen', 'a-b'],
    ['too long', 'a'.repeat(PREFIX_MAX_LENGTH + 1)],
    ['non-ascii', 'ключ'],
  ])('rejects %s', (_label, value) => {
    expect(() => normalizePrefix(value)).toThrow(EntityIdError);
    expect(isValidPrefix(value)).toBe(false);
  });

  it('accepts the exact length bounds', () => {
    expect(normalizePrefix('a'.repeat(PREFIX_MIN_LENGTH))).toHaveLength(
      PREFIX_MIN_LENGTH
    );
    expect(normalizePrefix('a'.repeat(PREFIX_MAX_LENGTH))).toHaveLength(
      PREFIX_MAX_LENGTH
    );
  });

  it('exposes the pattern it enforces', () => {
    expect(PREFIX_RE.test('usr')).toBe(true);
    expect(PREFIX_RE.test('USR')).toBe(false);
  });
});

describe('isValidPrefix', () => {
  it('normalizes before checking', () => {
    expect(isValidPrefix('  USR ')).toBe(true);
    expect(isValidPrefix('!!')).toBe(false);
  });
});

describe('derivePrefixFromSlug', () => {
  it('compresses a slug to a vowel-free consonant skeleton', () => {
    expect(derivePrefixFromSlug('program')).toBe('prg');
    expect(derivePrefixFromSlug('project')).toBe('prj');
    expect(derivePrefixFromSlug('user')).toBe('usr');
  });

  it('leaves no vowels after the first character', () => {
    for (const slug of ['program', 'project', 'request', 'memory', 'invoice']) {
      expect(derivePrefixFromSlug(slug).slice(1)).not.toMatch(/[aeiou]/);
    }
  });

  it('handles multi-word slugs', () => {
    for (const slug of [
      'knowledge_resource',
      'order-line',
      'chat message part',
    ]) {
      const prefix = derivePrefixFromSlug(slug);
      expect(prefix).toMatch(PREFIX_RE);
    }
  });

  it('always returns a prefix that passes normalizePrefix', () => {
    for (const slug of ['a', 'ab', 'aeiou', 'x1', 'zzz', 'ooo']) {
      expect(() => normalizePrefix(derivePrefixFromSlug(slug))).not.toThrow();
    }
  });

  it('honours the length bounds', () => {
    expect(
      derivePrefixFromSlug('knowledge_resource', { maxLen: 4 })
    ).toHaveLength(3);
    expect(
      derivePrefixFromSlug('knowledge_resource', { minLen: 5, maxLen: 8 })
        .length
    ).toBeGreaterThanOrEqual(5);
  });

  it('rejects an empty slug', () => {
    expect(() => derivePrefixFromSlug('')).toThrow(EntityIdError);
    expect(() => derivePrefixFromSlug('   ')).toThrow(EntityIdError);
  });
});

describe('ensureUniquePrefix', () => {
  it('returns the base prefix when it is free', () => {
    expect(ensureUniquePrefix('prj', 'project', new Set())).toBe('prj');
  });

  it('extends the prefix when it is taken', () => {
    const used = new Set(['prj']);
    const unique = ensureUniquePrefix('prj', 'project', used);
    expect(unique).not.toBe('prj');
    expect(used.has(unique)).toBe(false);
    expect(unique).toMatch(PREFIX_RE);
  });

  it('resolves a whole family of collisions', () => {
    const used = new Set<string>();
    for (const slug of ['project', 'projection', 'projector']) {
      const prefix = ensureUniquePrefix(derivePrefixFromSlug(slug), slug, used);
      expect(used.has(prefix)).toBe(false);
      used.add(prefix);
    }
    expect(used.size).toBe(3);
  });

  it('rejects an invalid base prefix', () => {
    expect(() => ensureUniquePrefix('1', 'x', new Set())).toThrow(
      EntityIdError
    );
  });
});

describe('EntityIdError', () => {
  it('is an Error carrying the offending value', () => {
    const error = new EntityIdError('boom', 'bad-value');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(EntityIdError);
    expect(error.name).toBe('EntityIdError');
    expect(error.message).toBe('boom');
    expect(error.value).toBe('bad-value');
  });
});
