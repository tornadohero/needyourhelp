/**
 * List paging (T030).
 *
 * `GET /providers` is bounded and paginated (`specs/05` §Discovery): a client
 * never asks for "everything". These helpers keep the merge honest — appending a
 * page must not duplicate a row when the server shifts one between pages.
 */

export interface ListState<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function initialList<T>(pageSize = 20): ListState<T> {
  return { items: [], total: 0, page: 0, pageSize };
}

/** Append a page, dropping rows that are already in the list. */
export function appendPage<T extends { id: string }>(
  state: ListState<T>,
  page: { items: T[]; total: number; page: number; pageSize: number },
): ListState<T> {
  const seen = new Set(state.items.map((item) => item.id));
  const added = page.items.filter((item) => !seen.has(item.id));

  return {
    items: [...state.items, ...added],
    total: page.total,
    page: page.page,
    pageSize: page.pageSize,
  };
}

/** `true` while there may be another page to fetch. */
export function hasMore(state: ListState<unknown>): boolean {
  if (state.page === 0) {
    return true;
  }
  return state.items.length < state.total;
}

/** The next page number, or `null` when the list is complete. */
export function nextPage(state: ListState<unknown>): number | null {
  return hasMore(state) ? state.page + 1 : null;
}

/** Replace the list with a fresh first page. */
export function resetWith<T extends { id: string }>(page: {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}): ListState<T> {
  return appendPage(initialList<T>(page.pageSize), page);
}
