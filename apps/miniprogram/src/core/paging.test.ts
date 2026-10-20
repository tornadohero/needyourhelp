import { describe, expect, it } from 'vitest';

import { appendPage, hasMore, initialList, nextPage, resetWith } from './paging';

interface Row {
  id: string;
  name: string;
}

function page(items: Row[], total: number, page: number, pageSize = 20) {
  return { items, total, page, pageSize };
}

describe('paging', () => {
  it('starts empty and asks for the first page', () => {
    const state = initialList<Row>();
    expect(state.items).toEqual([]);
    expect(nextPage(state)).toBe(1);
  });

  it('appends a page and remembers the total', () => {
    const state = appendPage(initialList<Row>(), page([{ id: 'a', name: 'A' }], 3, 1));
    expect(state.items.map((row) => row.id)).toEqual(['a']);
    expect(hasMore(state)).toBe(true);
    expect(nextPage(state)).toBe(2);
  });

  it('does not duplicate a row the server shifted into the next page', () => {
    const first = appendPage(
      initialList<Row>(),
      page(
        [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
        ],
        3,
        1,
      ),
    );
    const second = appendPage(
      first,
      page(
        [
          { id: 'b', name: 'B' },
          { id: 'c', name: 'C' },
        ],
        3,
        2,
      ),
    );

    expect(second.items.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('stops when the list is complete', () => {
    const state = appendPage(initialList<Row>(), page([{ id: 'a', name: 'A' }], 1, 1));
    expect(hasMore(state)).toBe(false);
    expect(nextPage(state)).toBeNull();
  });

  it('replaces the list when the filters change', () => {
    const full = appendPage(initialList<Row>(), page([{ id: 'a', name: 'A' }], 5, 1));
    const fresh = resetWith(page([{ id: 'z', name: 'Z' }], 1, 1));

    expect(fresh.items.map((row) => row.id)).toEqual(['z']);
    expect(full.items).toHaveLength(1);
  });
});
