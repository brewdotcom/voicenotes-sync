import VoiceNotesPlugin from '../src/main';
import VoiceNotesApi from '../src/api/voicenotes';
import { AppConfig } from '../src/config/app';
import { noticeMock } from 'obsidian';
import type { App, PluginManifest } from 'obsidian';

const visibleDocument = { visibilityState: 'visible' };
type TestablePlugin = {
  handleAppBecameActive(): Promise<void>;
  performSync(options?: { silent?: boolean }): Promise<boolean>;
};

const createPlugin = (): VoiceNotesPlugin => {
  const adapter = {
    exists: jest.fn().mockResolvedValue(true),
  };
  const app = {
    vault: {
      adapter,
      getMarkdownFiles: jest.fn().mockReturnValue([]),
      createFolder: jest.fn(),
    },
    metadataCache: {
      getFileCache: jest.fn(),
    },
  };
  const plugin = new VoiceNotesPlugin(app as unknown as App, {} as PluginManifest);
  plugin.settings = {
    ...AppConfig.DEFAULT_SETTINGS,
    token: 'test-token',
    automaticSync: true,
    syncTimeout: 0.5,
  };
  return plugin;
};

describe('instant sync scheduling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(global, 'document', {
      configurable: true,
      value: visibleDocument,
    });
    visibleDocument.visibilityState = 'visible';
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the existing three-hour default', () => {
    expect(AppConfig.DEFAULT_SETTINGS.syncTimeout).toBe(180);
  });

  it('runs a silent background sync every 30 seconds in Instant mode', async () => {
    const plugin = createPlugin();
    plugin.sync = jest.fn().mockResolvedValue(true);

    plugin.setupAutoSync();
    await jest.advanceTimersByTimeAsync(30_000);

    expect(plugin.sync).toHaveBeenCalledWith({ silent: true });
    plugin.clearAutoSync();
  });

  it('does not poll while Obsidian is hidden', async () => {
    const plugin = createPlugin();
    plugin.sync = jest.fn().mockResolvedValue(true);
    visibleDocument.visibilityState = 'hidden';

    plugin.setupAutoSync();
    await jest.advanceTimersByTimeAsync(5 * 60_000);

    expect(plugin.sync).not.toHaveBeenCalled();
  });

  it('syncs immediately when Obsidian becomes active', async () => {
    const plugin = createPlugin();
    plugin.sync = jest.fn().mockResolvedValue(true);

    await (plugin as unknown as TestablePlugin).handleAppBecameActive();

    expect(plugin.sync).toHaveBeenCalledWith({ silent: true });
    plugin.clearAutoSync();
  });

  it('backs off after a failed Instant sync', async () => {
    const plugin = createPlugin();
    plugin.sync = jest.fn().mockResolvedValue(false);

    plugin.setupAutoSync();
    await jest.advanceTimersByTimeAsync(30_000);
    await jest.advanceTimersByTimeAsync(59_999);
    expect(plugin.sync).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    expect(plugin.sync).toHaveBeenCalledTimes(2);
    plugin.clearAutoSync();
  });

  it('coalesces overlapping sync requests into one run', async () => {
    const plugin = createPlugin();
    let finishSync: (result: boolean) => void = () => undefined;
    const pendingSync = new Promise<boolean>((resolve) => {
      finishSync = resolve;
    });
    const performSync = jest.spyOn(plugin as unknown as TestablePlugin, 'performSync').mockReturnValue(pendingSync);

    const firstSync = plugin.sync({ silent: true });
    const secondSync = plugin.sync();

    expect(performSync).toHaveBeenCalledTimes(1);
    finishSync(true);
    await expect(Promise.all([firstSync, secondSync])).resolves.toEqual([true, true]);
  });

  it('suppresses notices for a successful background sync', async () => {
    const plugin = createPlugin();
    jest.spyOn(VoiceNotesApi.prototype, 'getRecordings').mockResolvedValue({
      data: [],
      links: {},
    });

    await expect(plugin.sync({ silent: true })).resolves.toBe(true);

    expect(noticeMock).not.toHaveBeenCalled();
  });
});
