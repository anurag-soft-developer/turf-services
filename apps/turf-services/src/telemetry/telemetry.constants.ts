/** Apps allowed to write client logs. A new app is another entry, not another collection. */
export const TELEMETRY_APP_IDS = ['turf_flutter'] as const;

/** Log kinds accepted in this pass. */
export const TELEMETRY_KINDS = ['error', 'screen'] as const;

export const TELEMETRY_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export const TELEMETRY_BATCH_LIMIT = 200;

export const TELEMETRY_PAYLOAD_MAX_BYTES = 4096;
