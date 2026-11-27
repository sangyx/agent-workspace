import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('electron', () => ({ safeStorage: {} }));
import { KeyStore } from '../../src/main/keystore';
const homes: string[] = [];
function setup() {
  const home = mkdtempSync(join(tmpdir(), 'amw-keys-')); homes.push(home);
  const file = join(home, 'openai-key.enc');
  const storage = {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    decryptStringAsync: vi.fn(async (_bytes: Buffer) => ({result:'sk-test-existing', shouldReEncrypt:false})),
    encryptStringAsync: vi.fn(async (_key: string) => Buffer.from('encrypted-fixture')),
  };
  return { file, storage, keys: new KeyStore(home, storage, 25) };
}
afterEach(() => { homes.splice(0).forEach(home => rmSync(home, {recursive:true, force:true})); });
it('does not initialize Keychain when no key is saved', async () => {
  const f = setup(); expect(await f.keys.load()).toBeUndefined();
  expect(f.storage.isAsyncEncryptionAvailable).not.toHaveBeenCalled();
});
it('reads legacy ciphertext through the nonblocking API and retains the saved bytes', async () => {
  const f = setup(); writeFileSync(f.file, 'legacy-ciphertext');
  expect(await f.keys.load()).toBe('sk-test-existing');
  expect(f.storage.decryptStringAsync).toHaveBeenCalledWith(Buffer.from('legacy-ciphertext'));
  expect(readFileSync(f.file, 'utf8')).toBe('legacy-ciphertext');
});
it('bounds a stalled Keychain read while the event loop stays responsive; retry can recover', async () => {
  const f = setup(); writeFileSync(f.file, 'keep');
  f.storage.decryptStringAsync.mockImplementationOnce(() => new Promise(() => {}));
  const request = f.keys.load();
  await new Promise(resolve => setTimeout(resolve, 1));
  await expect(request).rejects.toThrow('saved key is unchanged');
  expect(readFileSync(f.file, 'utf8')).toBe('keep');
  expect(await f.keys.load()).toBe('sk-test-existing');
});
it('does not overwrite a key when a timed-out save completes late', async () => {
  const f = setup(); writeFileSync(f.file, 'keep');
  let finish!: (bytes: Buffer) => void;
  f.storage.encryptStringAsync.mockImplementationOnce(() => new Promise(resolve => { finish=(bytes) => resolve(Buffer.from(bytes)); }));
  await expect(f.keys.save('new-key')).rejects.toThrow('secure storage');
  finish(Buffer.from('late')); await Promise.resolve();
  expect(readFileSync(f.file, 'utf8')).toBe('keep');
  expect(existsSync(f.file+'.tmp')).toBe(false);
});
it('bounds initialization and redacts OS diagnostics without deleting credentials', async () => {
  const f = setup(); writeFileSync(f.file, 'keep');
  f.storage.isAsyncEncryptionAvailable.mockImplementationOnce(() => new Promise(() => {}));
  await expect(f.keys.load()).rejects.toThrow('secure storage');
  f.storage.decryptStringAsync.mockRejectedValueOnce(new Error('private-secret-diagnostic'));
  await expect(f.keys.load()).rejects.not.toThrow('private-secret-diagnostic');
  expect(readFileSync(f.file, 'utf8')).toBe('keep');
});

it('never restores a credential that was cleared during an asynchronous save', async () => {
  const f = setup(); writeFileSync(f.file, 'old');
  let finish!: (bytes: Buffer) => void;
  f.storage.encryptStringAsync.mockImplementationOnce(() => new Promise(resolve => { finish=(bytes) => resolve(Buffer.from(bytes)); }));
  const save = f.keys.save('new');
  await vi.waitFor(() => expect(f.storage.encryptStringAsync).toHaveBeenCalled(), {interval:1});
  f.keys.clear(); finish(Buffer.from('late'));
  await expect(save).rejects.toThrow('superseded');
  expect(existsSync(f.file)).toBe(false);
});
