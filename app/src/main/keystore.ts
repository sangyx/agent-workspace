// Credentials remain encrypted on disk and only enter the main process.
import { existsSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';

type Storage = Pick<typeof safeStorage, 'isAsyncEncryptionAvailable' | 'encryptStringAsync' | 'decryptStringAsync'>;
export const KEYCHAIN_ERROR = 'macOS secure storage did not respond or could not unlock the saved API key. Your saved key is unchanged. Retry access in Settings > OpenAI.';

/** A hung OS credential provider must never hold up startup or an IPC indefinitely. */
export async function credentialRequest<T>(operation: () => Promise<T>, timeoutMs = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(KEYCHAIN_ERROR)), timeoutMs); }),
    ]);
  } catch {
    // OS diagnostics may include sensitive details. Never send them to the renderer.
    throw new Error(KEYCHAIN_ERROR);
  } finally { clearTimeout(timer); }
}

export class KeyStore {
  private file: string;
  private revision = 0;
  constructor(dataDir: string, private storage: Storage = safeStorage, private timeoutMs = 8000) {
    this.file = join(dataDir, 'openai-key.enc');
  }
  hasSaved(): boolean { return existsSync(this.file); }

  /** Also reads keys encrypted by the old synchronous API. Never falls back to that API. */
  async load(): Promise<string | undefined> {
    if (!this.hasSaved()) return undefined;
    return credentialRequest(async () => {
      if (!await this.storage.isAsyncEncryptionAvailable()) throw new Error(KEYCHAIN_ERROR);
      const value = await this.storage.decryptStringAsync(readFileSync(this.file));
      return value.result.trim() || undefined;
    }, this.timeoutMs);
  }

  async save(key: string): Promise<void> {
    const revision = ++this.revision;
    const encrypted = await credentialRequest(async () => {
      if (!await this.storage.isAsyncEncryptionAvailable()) throw new Error(KEYCHAIN_ERROR);
      return this.storage.encryptStringAsync(key);
    }, this.timeoutMs);
    if (revision !== this.revision) throw new Error('The credential request was superseded.');
    // A timeout never writes late results or overwrites an existing key.
    writeFileSync(this.file + '.tmp', encrypted, { mode: 0o600 });
    renameSync(this.file + '.tmp', this.file);
  }
  clear(): void { ++this.revision; rmSync(this.file, { force: true }); }
}
