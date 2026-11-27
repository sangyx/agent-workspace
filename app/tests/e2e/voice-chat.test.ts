import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { _electron as electron } from 'playwright-core';
import { expect, it } from 'vitest';
for (const style of ['claude', 'chatgpt'] as const)
  it(`keeps voice setup inline with ${style} and persists language, vocabulary and speaking voice`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'amw-voice-chat-')),
      at = new Date().toISOString();
    writeFileSync(
      join(home, 'workspace.json'),
      JSON.stringify({
        projects: [
          {
            projectId: 'p',
            rootPath: home,
            name: 'Research',
            kind: 'research',
          },
        ],
        tasks: [
          {
            taskId: 't',
            alias: 'Voice test',
            name: 'Voice test',
            nameSource: 'user',
            projectId: 'p',
            provider: 'mock',
            cwd: home,
            title: 'Voice test',
            status: 'done',
            summary: '',
            createdAt: at,
            updatedAt: at,
          },
        ],
        settings: {
          mainAgent: 'off',
          onboarding: { dismissed: true },
          language: 'en',
          chatAppearance: { interfaceStyle: style },
        },
      }),
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({
      executablePath: require('electron') as string,
      args: [resolve(__dirname, '../..')],
      env: {
        ...env,
        HOME: home,
        AMW_DATA_DIR: home,
        AMW_MAIN_AGENT: 'off',
        AMW_NO_OPENAI: '1',
        AMW_NO_AUTOLISTEN: '1',
      },
    });
    try {
      const page = await app.firstWindow();
      await page.waitForSelector('.app');
      await page
        .locator('[data-testid="rail-item"][data-alias="Voice test"]')
        .click();
      const voice = page.getByTestId('voice-chat-toggle');
      await voice.waitFor();
      expect(await page.locator('[role="dialog"]').count()).toBe(0);
      await voice.click();
      await page.getByTestId('speech-settings').waitFor();
      await page
        .getByLabel('Spoken language', { exact: true })
        .selectOption('mixed');
      const vocab = page.getByLabel('Research vocabulary', { exact: true });
      await vocab.fill('LoRA, Zotero, ablation');
      await vocab.blur();
      await page
        .getByLabel('Speaking voice', { exact: true })
        .selectOption('quartz');
      await expect
        .poll(
          () =>
            JSON.parse(readFileSync(join(home, 'workspace.json'), 'utf8'))
              .settings.recognition,
        )
        .toEqual({ language: 'mixed', vocabulary: 'LoRA, Zotero, ablation' });
      await expect
        .poll(
          () =>
            JSON.parse(readFileSync(join(home, 'workspace.json'), 'utf8'))
              .settings.liveVoice.voice,
        )
        .toBe('quartz');
      await page
        .getByTestId('settings-page')
        .locator('.stage-head')
        .getByRole('button', { name: 'Close', exact: true })
        .click();
      await voice.waitFor();
      expect(await page.getByTestId('focus-title').innerText()).toContain(
        'Voice test',
      );
    } finally {
      await app.close();
    }
  }, 60000);
for (const style of ['claude', 'chatgpt'] as const)
  it(`runs inline voice chat with the existing mock agent in ${style}, without audio devices or cloud requests`, async () => {
    const home = mkdtempSync(join(tmpdir(), 'amw-voice-flow-')),
      at = new Date().toISOString();
    writeFileSync(
      join(home, 'workspace.json'),
      JSON.stringify({
        projects: [
          {
            projectId: 'p',
            rootPath: home,
            name: 'Research',
            kind: 'research',
          },
        ],
        tasks: [
          {
            taskId: 't',
            alias: 'Voice flow',
            name: 'Voice flow',
            nameSource: 'user',
            projectId: 'p',
            provider: 'mock',
            cwd: home,
            title: 'Voice flow',
            status: 'idle',
            summary: '',
            createdAt: at,
            updatedAt: at,
          },
        ],
        settings: {
          mainAgent: 'off',
          onboarding: { dismissed: true },
          language: 'en',
          autoListen: false,
          chatAppearance: { interfaceStyle: style },
        },
      }),
    );
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({
      executablePath: require('electron') as string,
      args: [resolve(__dirname, '../..')],
      env: {
        ...env,
        HOME: home,
        AMW_DATA_DIR: home,
        AMW_MAIN_AGENT: 'off',
        OPENAI_API_KEY: 'test-only-key',
        AMW_NO_OPENAI: '0',
        AMW_NO_AUTOLISTEN: '1',
        AMW_MOCK_DELAY_MS: '5',
      },
    });
    try {
      await app.evaluate(({ systemPreferences }) => {
        globalThis.fetch = async (input: any) => {
          if (String(input).includes('/v1/live/sessions'))
            return new Response(
              JSON.stringify({
                session: { id: 'live_test' },
                transport: { type: 'webrtc', sdp: 'answer' },
              }),
              { status: 201 },
            );
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        };
        systemPreferences.getMediaAccessStatus = () => 'granted';
      });
      const page = await app.firstWindow();
      await page.evaluate(() => {
        const w = window as any;
        w.__voiceTrack = {
          enabled: true,
          stop() {
            this.enabled = false;
          },
        };
        Object.defineProperty(navigator, 'mediaDevices', {
          configurable: true,
          value: {
            getUserMedia: async () => ({
              getTracks: () => [w.__voiceTrack],
              getAudioTracks: () => [w.__voiceTrack],
            }),
          },
        });
        w.Audio = class {
          autoplay = false;
          srcObject = null;
          async play() {}
          pause() {}
        };
        w.RTCPeerConnection = class extends EventTarget {
          localDescription = { sdp: 'offer' };
          iceGatheringState = 'complete';
          connectionState = 'connected';
          channel = new (class extends EventTarget {
            readyState = 'open';
            sent: any[] = [];
            emit(event: any) {
              this.dispatchEvent(
                new MessageEvent('message', { data: JSON.stringify(event) }),
              );
            }
            send(data: string) {
              const event = JSON.parse(data);
              this.sent.push(event);
              if (event.type === 'session.close')
                setTimeout(
                  () =>
                    this.emit({
                      type: 'session.closed',
                      usage: { seconds: 3 },
                    }),
                  1,
                );
            }
            close() {
              this.readyState = 'closed';
            }
          })();
          addTrack() {}
          createDataChannel() {
            w.__voiceChannel = this.channel;
            return this.channel;
          }
          async createOffer() {
            return this.localDescription;
          }
          async setLocalDescription() {}
          async setRemoteDescription() {
            this.channel.emit({ type: 'session.started' });
          }
          close() {}
        };
      });
      await page.waitForSelector('.app');
      await page
        .locator('[data-testid="rail-item"][data-alias="Voice flow"]')
        .click();
      await page.getByTestId('voice-chat-toggle').click();
      await expect
        .poll(() =>
          page.getByTestId('voice-chat-toggle').getAttribute('aria-pressed'),
        )
        .toBe('true');
      await page
        .getByRole('button', { name: 'Mute voice chat', exact: true })
        .waitFor();
      await expect
        .poll(() =>
          page
            .getByRole('button', { name: 'Mute voice chat', exact: true })
            .isEnabled(),
        )
        .toBe(true);
      await page.evaluate(() => {
        const ch = (window as any).__voiceChannel;
        ch.emit({
          type: 'session.input_transcript.delta',
          delta: 'Explain the current plan.',
        });
        ch.emit({
          type: 'session.delegation.created',
          delegation: { id: 'delegation-test', target: 'client' },
        });
      });
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as any).__voiceChannel.sent.filter(
                (e: any) => e.type === 'session.commentary.append',
              ).length,
          ),
        )
        .toBeGreaterThan(0);
      const transcript = await page.evaluate(
        async () =>
          await (window as any).amw.invoke('transcript:get', { taskId: 't' }),
      );
      expect(
        transcript.filter(
          (i: any) =>
            i.role === 'user' && i.text === 'Explain the current plan.',
        ),
      ).toHaveLength(1);
      await page
        .getByRole('button', { name: 'Mute voice chat', exact: true })
        .click();
      expect(
        await page.evaluate(() => (window as any).__voiceTrack.enabled),
      ).toBe(false);
      await page.getByTestId('voice-chat-toggle').click();
      await expect
        .poll(() =>
          page.getByTestId('voice-chat-toggle').getAttribute('aria-pressed'),
        )
        .toBe('false');
      expect(await page.locator('[role="dialog"]').count()).toBe(0);
    } finally {
      await app.close();
    }
  }, 60000);
