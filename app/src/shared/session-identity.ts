import type { NativeSessionInfo } from './types';

/** Provider IDs can collide across providers or SSH machines. */
export const sessionKey = (session: Pick<NativeSessionInfo, 'provider' | 'host' | 'nativeSessionId'>) =>
  JSON.stringify([session.provider, session.host || '', session.nativeSessionId]);
