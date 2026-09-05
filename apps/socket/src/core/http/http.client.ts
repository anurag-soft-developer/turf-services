import axios from 'axios';
import { config } from '../config/env.config';

export const internalHttp = axios.create({
  baseURL: config.TURF_SERVICES_BASE_URL.replace(/\/$/, ''),
  timeout: 5000,
  headers: {
    'x-internal-token': config.INTERNAL_TOKEN,
  },
});
