import z from 'zod';
import { createZodDto, type ZodDto } from 'nestjs-zod';
import { endOfDay, startOfDay } from './utils/date.util';

export const date = z
  .string()
  .refine((val) => !isNaN(Date.parse(val)), 'Invalid date time format');

export const calendarDateStart = date.transform(startOfDay);
export const calendarDateEnd = date.transform(endOfDay);

/** Spread into filter/search schemas: inclusive calendar-day range on query params. */
export const dateRangeQueryFields = {
  startDate: calendarDateStart.optional(),
  endDate: calendarDateEnd.optional(),
} as const;

/**
 * Nest/Express query: `key=a,b` and/or repeated `key=` → trimmed non-empty strings.
 */
export function commaSeparatedQueryToStrings(
  val: unknown,
): string[] | undefined {
  if (val == null || val === '') return undefined;
  if (Array.isArray(val)) {
    return val
      .flatMap((x) =>
        typeof x === 'string' ? x.split(',').map((s) => s.trim()) : [],
      )
      .filter(Boolean);
  }
  if (typeof val === 'string') {
    return val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return undefined;
}

/**
 * Query param boolean: `key=true`, `key=false`, `key=1`, `key=0`.
 * Avoids `z.coerce.boolean()` treating the string `"false"` as true.
 */
export function parseBooleanQuery() {
  return z.preprocess((val): boolean | undefined => {
    if (val == null || val === '') return undefined;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') {
      if (val === 1) return true;
      if (val === 0) return false;
      return undefined;
    }
    if (typeof val === 'string') {
      const lowered = val.trim().toLowerCase();
      if (lowered === 'true' || lowered === '1') return true;
      if (lowered === 'false' || lowered === '0') return false;
    }
    return undefined;
  }, z.boolean().optional());
}

/**
 * Query param as one status or many: `status=pending` or `status=completed,cancelled`.
 */
export function parseEnumQuery<T extends string>(
  enumSchema: z.ZodType<T>,
  max = 10,
) {
  return z.preprocess(
    commaSeparatedQueryToStrings,
    z.array(enumSchema).max(max).optional(),
  );
}

/**
 * Query param as one string or many: `event=<id>` or `event=<id1>,<id2>`.
 */
export function parseStringArrayQuery(max = 20) {
  return z.preprocess(
    commaSeparatedQueryToStrings,
    z.array(z.string().min(1)).max(max).optional(),
  );
}

/**
 * GeoJSON Point: coordinates are [longitude, latitude].
 * Matches `GeoPoint` / `GeoLocation.coordinates` in geo-location.schema.
 * `type` defaults to `"Point"` when omitted.
 */
export const geoPointSchema = z.object({
  type: z.literal('Point').default('Point'),
  coordinates: z.tuple([
    z.number().gte(-180).lte(180),
    z.number().gte(-90).lte(90),
  ]),
});

const geoLocationOptionalFields = {
  city: z.string().trim().min(1).optional(),
  state: z.string().trim().min(1).optional(),
  zip: z.string().trim().min(1).optional(),
  country: z.string().trim().min(1).optional(),
};

/** Full location body; matches `GeoLocation` in geo-location.schema. */
export const geoLocationSchema = z.object({
  address: z.string().trim().min(1),
  coordinates: geoPointSchema,
  ...geoLocationOptionalFields,
});

/** PATCH-style location: at least one of address or coordinates. */
export const geoLocationPartialSchema = z
  .object({
    address: z.string().trim().min(1).optional(),
    coordinates: geoPointSchema.optional(),
    ...geoLocationOptionalFields,
  })
  .refine((d) => d.address !== undefined || d.coordinates !== undefined, {
    message: 'Provide address and/or coordinates',
  });

/** Geo filter: query params or nested under `location` (lat/lng + radius km). */
export const nearbyLocationQuerySchema = z.object({
  nearbyLat: z.coerce.number().gte(-90).lte(90),
  nearbyLng: z.coerce.number().gte(-180).lte(180),
  nearbyRadiusKm: z.coerce.number().min(0.1).max(500).default(100),
});

export class LocationFilterDto extends createZodDto(
  nearbyLocationQuerySchema,
) {}
