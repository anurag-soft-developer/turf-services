import { Model, PopulateOptions, Types } from 'mongoose';
import type { PaginatedResult } from '../interfaces/common';

export type NearbyLocationQuery = {
  nearbyLat: number;
  nearbyLng: number;
  nearbyRadiusKm?: number;
};

export function applyExcludeIds(
  match: Record<string, unknown>,
  excludeIds?: string[],
): void {
  if (!excludeIds?.length) return;
  const oids = excludeIds
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
  if (!oids.length) return;

  const existing = match._id;
  if (
    existing &&
    typeof existing === 'object' &&
    existing !== null &&
    '$nin' in existing
  ) {
    const nin = (existing as { $nin: Types.ObjectId[] }).$nin ?? [];
    (existing as { $nin: Types.ObjectId[] }).$nin = [...nin, ...oids];
    return;
  }
  match._id = { $nin: oids };
}

/**
 * Soft nearby pagination: prefer closer items; `nearbyRadiusKm` is ignored.
 * Docs without coordinates are included and sorted last.
 * Ranks within a recent candidate window (`SOFT_DISTANCE_CANDIDATE_CAP`).
 */
export const SOFT_DISTANCE_CANDIDATE_CAP = 500;

export async function paginateSortedByDistance<T>(params: {
  model: Model<T>;
  /** Dot path to GeoJSON point or `.coordinates` array (e.g. `lastLocation`, `location.coordinates`). */
  geoKey: string;
  location: NearbyLocationQuery;
  match: Record<string, unknown>;
  page: number;
  limit: number;
  populate?: PopulateOptions | PopulateOptions[];
  fallbackSort?: Record<string, 1 | -1>;
}): Promise<PaginatedResult<T>> {
  const {
    model,
    geoKey,
    location,
    match,
    page,
    limit,
    populate,
    fallbackSort = { updatedAt: -1 },
  } = params;

  const selectField = geoKey.endsWith('.coordinates')
    ? geoKey.slice(0, -'.coordinates'.length)
    : geoKey;

  const [leanDocs, totalDocuments] = await Promise.all([
    model
      .find(match)
      .select(`_id ${selectField}`)
      .sort(fallbackSort)
      .limit(SOFT_DISTANCE_CANDIDATE_CAP)
      .lean()
      .exec(),
    model.countDocuments(match),
  ]);

  const ranked = leanDocs
    .map((doc) => {
      const lngLat = lngLatFromGeoKey(doc, geoKey);
      const km =
        lngLat != null
          ? haversineKm(
              location.nearbyLat,
              location.nearbyLng,
              lngLat[1],
              lngLat[0],
            )
          : Number.POSITIVE_INFINITY;
      return { id: (doc as { _id: Types.ObjectId })._id, km };
    })
    .sort((a, b) => a.km - b.km);

  const skip = (page - 1) * limit;
  const pageIds = ranked.slice(skip, skip + limit).map((r) => r.id);
  if (!pageIds.length) {
    return {
      data: [],
      totalDocuments,
      page,
      limit,
      totalPages: Math.ceil(totalDocuments / limit) || 0,
    };
  }

  let query = model.find({ _id: { $in: pageIds } });
  if (populate) {
    query = query.populate(populate);
  }
  const docs = await query.exec();
  const order = new Map<string, number>(
    pageIds.map((id, i) => [id.toString(), i]),
  );
  docs.sort((a, b) => {
    const doc = a as { _id: Types.ObjectId };
    const other = b as { _id: Types.ObjectId };
    return (
      (order.get(doc._id.toString()) ?? 0) - (order.get(other._id.toString()) ?? 0)
    );
  });

  return {
    data: docs as T[],
    totalDocuments,
    page,
    limit,
    totalPages: Math.ceil(totalDocuments / limit) || 0,
  };
}

function lngLatFromGeoKey(
  doc: unknown,
  geoKey: string,
): [number, number] | undefined {
  let cur: unknown = doc;
  for (const part of geoKey.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  if (Array.isArray(cur) && cur.length >= 2) {
    const lng = Number(cur[0]);
    const lat = Number(cur[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined;
    return [lng, lat];
  }
  return coordinatesLngLat(cur as { coordinates?: [number, number] } | null);
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function coordinatesLngLat(
  point?: { coordinates?: [number, number] } | null,
): [number, number] | undefined {
  const coords = point?.coordinates;
  if (!coords || coords.length < 2) return undefined;
  const lng = coords[0];
  const lat = coords[1];
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined;
  return [lng, lat];
}
