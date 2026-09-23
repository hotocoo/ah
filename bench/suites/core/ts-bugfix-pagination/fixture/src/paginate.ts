export interface Page<T> {
  items: T[];
  page: number;
  totalPages: number;
}

// Returns the 1-based `page` of `items`, `size` items per page.
export function paginate<T>(items: T[], page: number, size: number): Page<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const start = page * size;
  return { items: items.slice(start, start + size), page, totalPages };
}
