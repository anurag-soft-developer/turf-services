export const JobName = {
  PaymentHoldRelease: 'payment-hold-release',
  TeamInviteExpiry: 'team-invite-expiry',
  TeamMatchExpiry: 'team-match-expiry',
  UnusedUploadPurge: 'unused-upload-purge',
  EngagementStatsFlush: 'engagement-stats-flush',
  ChatFlush: 'chat-flush',
} as const;

export type JobName = (typeof JobName)[keyof typeof JobName];

export type RemoteJobName = Exclude<JobName, typeof JobName.ChatFlush>;
