import { NotificationDocument } from "../schemas/notification.schema";

export function buildPushDataStrings(
    doc: NotificationDocument,
  ): Record<string, string> {
    const base: Record<string, string> = {
      notificationId: doc._id.toString(),
      module: doc.module,
    };
    const fromDoc = flattenUnknown(doc.data ?? {});
    return { ...fromDoc, ...base };
  }

  export function flattenUnknown(
    input: Record<string, unknown>,
    prefix = '',
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(input)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v === null || v === undefined) continue;
      if (typeof v === 'object' && !Array.isArray(v)) {
        Object.assign(
          out,
          flattenUnknown(v as Record<string, unknown>, key),
        );
      } else {
        out[key] = String(v);
      }
    }
    return out;
  }