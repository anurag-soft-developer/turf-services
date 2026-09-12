import { Types } from 'mongoose';
import type { EngagementEntityType } from '../engagement.constants';

export function buildEntityOrClauses(
  refs: { entityType: EngagementEntityType; entityId: string }[],
): { entityType: EngagementEntityType; entityId: { $in: Types.ObjectId[] } }[] {
  const byType = new Map<EngagementEntityType, Types.ObjectId[]>();
  for (const ref of refs) {
    if (!Types.ObjectId.isValid(ref.entityId)) continue;
    const list = byType.get(ref.entityType) ?? [];
    list.push(new Types.ObjectId(ref.entityId));
    byType.set(ref.entityType, list);
  }
  return [...byType.entries()].map(([entityType, ids]) => ({
    entityType,
    entityId: { $in: ids },
  }));
}

export function toInt(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export function parseStatsKey(
  key: string,
): { entityType: EngagementEntityType; entityId: Types.ObjectId } | null {
  const parts = key.split(':');
  if (parts.length < 3 || parts[0] !== 'stats') return null;
  const entityType = parts[1] as EngagementEntityType;
  const entityId = parts.slice(2).join(':');
  if (!Types.ObjectId.isValid(entityId)) return null;
  return { entityType, entityId: new Types.ObjectId(entityId) };
}
