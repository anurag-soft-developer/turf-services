import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import * as admin from 'firebase-admin';
import { config } from '../core/config/env.config';

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private appReady = false;

  onModuleInit(): void {
    if (admin.apps.length > 0) {
      this.appReady = true;
      return;
    }
    try {
      if (config.FIREBASE_SERVICE_ACCOUNT_JSON) {
        const sa = JSON.parse(
          config.FIREBASE_SERVICE_ACCOUNT_JSON,
        ) as admin.ServiceAccount;
        admin.initializeApp({ credential: admin.credential.cert(sa) });
        this.appReady = true;
        this.logger.log(
          'Firebase Admin initialized from FIREBASE_SERVICE_ACCOUNT_JSON',
        );
      } else if (config.GOOGLE_APPLICATION_CREDENTIALS) {
        const raw = readFileSync(config.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
        const sa = JSON.parse(raw) as admin.ServiceAccount;
        admin.initializeApp({ credential: admin.credential.cert(sa) });
        this.appReady = true;
        this.logger.log(
          'Firebase Admin initialized from GOOGLE_APPLICATION_CREDENTIALS file',
        );
      } else {
        this.logger.warn(
          'FCM disabled: set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS',
        );
      }
    } catch (e) {
      this.logger.error('Firebase Admin init failed', e);
    }
  }

  isReady(): boolean {
    return this.appReady;
  }

  async sendMulticast(
    tokens: string[],
    title: string,
    body: string,
    data: Record<string, string>,
  ): Promise<{ successCount: number; failureCount: number }> {
    if (!this.appReady || tokens.length === 0) {
      return { successCount: 0, failureCount: 0 };
    }
    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
    });
    return {
      successCount: res.successCount,
      failureCount: res.failureCount,
    };
  }
}
