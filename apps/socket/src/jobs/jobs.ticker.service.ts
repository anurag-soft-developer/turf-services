import { Injectable, Logger } from '@nestjs/common';
import { isAxiosError } from 'axios';
import { randomUUID } from 'crypto';
import { internalHttp } from '../core/http/http.client';
import { RedisService } from '../core/redis/redis.service';
import type { JobName, RemoteJobName } from './jobs.types';

const JOB_HTTP_TIMEOUT_MS = 60_000;
const DEFAULT_LOCK_TTL_SECONDS = 90;

type JobStatus = 'success' | 'failed';

type StoredJobStatus = {
  status: JobStatus;
  lastRunAt: string;
  lastSuccessAt?: string;
  lastFailedAt?: string;
  lastError: string | null;
  durationMs: number;
};

@Injectable()
export class JobsTickerService {
  private readonly logger = new Logger(JobsTickerService.name);

  constructor(private readonly redisService: RedisService) {}

  async runRemote(
    jobName: RemoteJobName,
    lockTtlSeconds = DEFAULT_LOCK_TTL_SECONDS,
  ): Promise<void> {
    await this.run(
      jobName,
      () => this.postJob(`/internal/jobs/${jobName}`),
      lockTtlSeconds,
    );
  }

  async run(
    jobName: JobName,
    work: () => Promise<unknown>,
    lockTtlSeconds = DEFAULT_LOCK_TTL_SECONDS,
  ): Promise<void> {
    const client = await this.redisService.getClient();
    const lockKey = `cron:lock:${jobName}`;
    const statusKey = `cron:status:${jobName}`;
    const owner = `${process.pid}:${randomUUID()}`;
    const acquired = await client.set(lockKey, owner, {
      NX: true,
      EX: lockTtlSeconds,
    });

    if (acquired !== 'OK') {
      this.logger.debug(`Skipped ${jobName}: lock held`);
      return;
    }

    const startedAt = Date.now();
    try {
      await work();
      await this.writeStatus(statusKey, {
        status: 'success',
        lastRunAt: new Date().toISOString(),
        lastSuccessAt: new Date().toISOString(),
        lastError: null,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const lastError = this.toErrorMessage(error);
      await this.writeStatus(statusKey, {
        status: 'failed',
        lastRunAt: new Date().toISOString(),
        lastFailedAt: new Date().toISOString(),
        lastError,
        durationMs: Date.now() - startedAt,
      });
      this.logger.error(`${jobName} failed: ${lastError}`);
    } finally {
      const current = await client.get(lockKey);
      if (current === owner) {
        await client.del(lockKey);
      }
    }
  }

  private async postJob(path: string): Promise<void> {
    await internalHttp.post(path, {}, { timeout: JOB_HTTP_TIMEOUT_MS });
  }

  private async writeStatus(
    statusKey: string,
    patch: StoredJobStatus,
  ): Promise<void> {
    const client = await this.redisService.getClient();
    const previous = await this.readStatus(statusKey);
    await client.set(
      statusKey,
      JSON.stringify({
        ...previous,
        ...patch,
        lastSuccessAt: patch.lastSuccessAt ?? previous?.lastSuccessAt,
        lastFailedAt: patch.lastFailedAt ?? previous?.lastFailedAt,
      }),
    );
  }

  private async readStatus(
    statusKey: string,
  ): Promise<Partial<StoredJobStatus> | null> {
    const client = await this.redisService.getClient();
    const raw = await client.get(statusKey);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as StoredJobStatus;
    } catch {
      return null;
    }
  }

  private toErrorMessage(error: unknown): string {
    if (isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data;
      const detail =
        typeof data === 'string'
          ? data
          : data && typeof data === 'object'
            ? JSON.stringify(data)
            : error.message;
      return status ? `HTTP ${status}: ${detail}` : error.message;
    }
    return error instanceof Error ? error.message : String(error);
  }
}
