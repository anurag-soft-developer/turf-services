import {
  getChatRoomKey,
  normalizePlayerScopeId,
  sendMessageEventSchema,
} from './chat.shared';

describe('chat shared helpers', () => {
  it('normalizes player scope ids deterministically', () => {
    expect(normalizePlayerScopeId('userB', 'userA')).toBe('userA:userB');
    expect(normalizePlayerScopeId('userA', 'userB')).toBe('userA:userB');
  });

  it('builds room keys by scope and id', () => {
    expect(getChatRoomKey({ scope: 'team', scopeId: 'team-1' })).toBe(
      'chat:team:team-1',
    );
  });

  it('validates chat send payload', () => {
    const payload = sendMessageEventSchema.parse({
      scope: 'match',
      scopeId: 'match-1',
      body: 'hello',
    });
    expect(payload.scope).toBe('match');
  });
});
