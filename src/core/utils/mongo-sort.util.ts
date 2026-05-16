/**
 * MongoDB `.sort()` and aggregation `$sort` shape.
 */
export type MongoSortSpec = Record<string, 1 | -1>;

export type BuildMongoSortOptionsConfig = {
  defaultSort: MongoSortSpec;
  /** Map API / client field names to Mongo paths (e.g. `price` → `pricing.basePricePerHour`). */
  fieldMap?: Record<string, string>;
  /** If set, only these Mongo field paths may appear in the output. */
  allowedFields?: ReadonlySet<string>;
  /**
   * When the client sends a non-empty `sort` string but nothing valid was parsed:
   * - `default` → return [defaultSort] (typical list APIs)
   * - `none` → return `{}` so callers can omit `$sort` (e.g. turf search aggregation)
   */
  whenParsedEmpty: 'default' | 'none';
};

/**
 * Parse a sort query like `"createdAt:desc"` or `"field:asc,other:desc"`.
 * Same contract as legacy `TurfService.buildSortOptions`: comma-separated
 * `field:order` tokens; `order` is `asc` or `desc` (case-insensitive).
 */
export function buildMongoSortOptions(
  sortString: string | undefined | null,
  config: BuildMongoSortOptionsConfig,
): MongoSortSpec {
  const { defaultSort, fieldMap = {}, allowedFields, whenParsedEmpty } =
    config;

  if (!sortString?.trim()) {
    return { ...defaultSort };
  }

  const sortOptions: MongoSortSpec = {};
  for (const raw of sortString.split(',')) {
    const field = raw.trim();
    if (!field) continue;
    const parts = field.split(':');
    const fieldName = parts[0]?.trim();
    const order = parts[1]?.trim();
    if (!fieldName || !order) continue;

    const mapped = fieldMap[fieldName] ?? fieldName;
    if (allowedFields && !allowedFields.has(mapped)) {
      continue;
    }

    sortOptions[mapped] = order.toLowerCase() === 'asc' ? 1 : -1;
  }

  if (Object.keys(sortOptions).length === 0) {
    return whenParsedEmpty === 'none' ? {} : { ...defaultSort };
  }
  return sortOptions;
}
