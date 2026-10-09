// Integration: first launch. Query by role and label, not by descriptive copy.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgressInfo } from './types';

vi.mock('./lib/transcribe', () => ({
  transcribe: vi.fn(),
  preloadTranscriber: vi.fn(() => Promise.resolve()),
  testTranscription: vi.fn(() => Promise.resolve({ ok: true, message: 'Connected' })),
}));

// EngineSetup keeps "downloaded" state in module scope, so load a fresh copy of the app for each test.
async function freshApp() {
  vi.resetModules();
  const transcribeMod = await import('./lib/transcribe');
  const settingsMod = await import('./lib/settings');
  const { default: App } = await import('./App');
  const preload = vi.mocked(transcribeMod.preloadTranscriber);
  const test = vi.mocked(transcribeMod.testTranscription);
  preload.mockResolvedValue(undefined);
  test.mockResolvedValue({ ok: true, message: 'Connected' });
  return {
    App,
    preload,
    test,
    loadSettings: settingsMod.loadSettings,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('first launch', () => {
  it('shows the setup screen instead of Home, with no navigation icons', async () => {
    const { App } = await freshApp();
    render(<App />);
    expect(screen.getByRole('heading', { name: /Set up HireCrack/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start practice' })).not.toBeInTheDocument();
  });

  it('enables Continue after the speech model loads, with rules scoring, then lands on Home', async () => {
    const { App, preload, loadSettings } = await freshApp();
    let finish!: () => void;
    preload.mockImplementation(
      (_s, onProgress?: (p: ProgressInfo) => void) =>
        new Promise<void>((resolve) => {
          onProgress?.({ stage: 'Downloading', progress: 0.5 });
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Scoring' }), 'rules');
    expect(screen.getByRole('combobox', { name: 'Transcription' })).toHaveValue('local');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Download' }));
    const bar = await screen.findByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled());
    expect(preload).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('button', { name: 'Start practice' })).toBeInTheDocument();
    expect(loadSettings()).toMatchObject({ onboarded: true, scoring: 'rules', transcription: 'local' });
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();
  });

  it('shows a download error and keeps Continue disabled when the model fails to load', async () => {
    const { App, preload } = await freshApp();
    preload.mockRejectedValue(new Error('network down'));
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Scoring' }), 'rules');
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('network down');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('needs a tested API key for OpenAI transcription', async () => {
    const { App, test } = await freshApp();
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Scoring' }), 'rules');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Transcription' }), 'openai');

    const testButton = screen.getByRole('button', { name: 'Test' });
    expect(testButton).toBeDisabled(); // no key yet
    // Typed key by key: the field used to remount on every keystroke and keep only one character.
    const keyInput = screen.getByLabelText('OpenAI API key');
    await user.type(keyInput, 'sk-abc');
    expect(keyInput).toHaveValue('sk-abc');
    expect(screen.getByLabelText('OpenAI API key')).toBe(keyInput); // same element, not remounted
    await user.click(screen.getByRole('button', { name: 'Test' })); // re-queried: the Test row resets when the key changes

    expect(await screen.findByRole('status')).toHaveTextContent('Connected');
    expect(test).toHaveBeenCalledWith(
      expect.objectContaining({ transcription: 'openai', openaiKey: 'sk-abc' }),
    );
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  it('clears a passed key test when the key is edited', async () => {
    const { App } = await freshApp();
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Scoring' }), 'rules');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Transcription' }), 'openai');
    const keyInput = screen.getByLabelText('OpenAI API key');
    await user.type(keyInput, 'sk-abc');
    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Connected');

    await user.type(keyInput, 'd');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('reports a rejected API key and keeps Continue disabled', async () => {
    const { App, test } = await freshApp();
    test.mockResolvedValue({ ok: false, message: 'Invalid API key' });
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Scoring' }), 'rules');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Transcription' }), 'openai');
    await user.type(screen.getByLabelText('OpenAI API key'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Invalid API key');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('"Skip for now" goes Home with the built-in rules and local Whisper, and remembers it', async () => {
    const { App, loadSettings } = await freshApp();
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('button', { name: 'Start practice' })).toBeInTheDocument();
    expect(loadSettings()).toMatchObject({ onboarded: true, scoring: 'rules', transcription: 'local' });

    // A second launch goes straight to Home.
    unmount();
    render(<App />);
    expect(screen.getByRole('button', { name: 'Start practice' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Set up HireCrack/ })).not.toBeInTheDocument();
  });
});
