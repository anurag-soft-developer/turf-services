import axios from 'axios';
import { config } from '../config/env.config';

const realtimeBaseUrl = config.REALTIME_TURF_BASE_URL.replace(/\/$/, '');

export const internalHttp = axios.create({
  ...(realtimeBaseUrl ? { baseURL: realtimeBaseUrl } : {}),
  timeout: 5000,
  headers: {
    'x-internal-token': config.INTERNAL_TOKEN,
  },
});
