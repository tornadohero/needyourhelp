import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WXML compile guards (T035b 之后补).
 *
 * The pages are not covered by unit tests — they are WeChat lifecycle objects —
 * but some template mistakes only surface **inside WeChat DevTools**, which is
 * the worst place to find them. These checks read the `.wxml` sources and assert
 * the two rules the compiler enforces quietly:
 *
 * 1. `wx:else` / `wx:elif` must not share a node with `wx:for`: the compiler
 *    processes the loop first and then reports `wx:if not found`
 *    (broken in `pages/me` once, fixed by wrapping the loop in a `<block>`);
 * 2. every `wx:for` has a `wx:key`, otherwise list updates reuse the wrong nodes.
 */
const PAGES_DIR = path.resolve(__dirname, '..', '..', 'pages');

function wxmlFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...wxmlFiles(full));
    } else if (entry.endsWith('.wxml')) {
      files.push(full);
    }
  }
  return files;
}

function tagAttributes(source: string, tag: string): string[] {
  // One entry per opening tag, so two separate nodes are never confused.
  return [...source.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map((match) => match[0]);
}

describe('wxml compile guards', () => {
  const files = wxmlFiles(PAGES_DIR);

  it('finds the page templates to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('never puts wx:else or wx:elif on the same node as wx:for', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const attributes of [
        ...tagAttributes(source, 'view'),
        ...tagAttributes(source, 'block'),
        ...tagAttributes(source, 'text'),
      ]) {
        const hasElse = /\swx:else\b/.test(attributes) || /\swx:elif\b/.test(attributes);
        const hasFor = /\swx:for=/.test(attributes);
        if (hasElse && hasFor) {
          offenders.push(`${path.relative(PAGES_DIR, file)}: ${attributes.slice(0, 80)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('gives every wx:for a wx:key so list updates reuse the right nodes', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const attributes of tagAttributes(source, 'view')) {
        if (/\swx:for=/.test(attributes) && !/\swx:key=/.test(attributes)) {
          offenders.push(`${path.relative(PAGES_DIR, file)}: ${attributes.slice(0, 80)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
