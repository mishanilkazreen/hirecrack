// Integration: Settings and History pages inside the real App. Query by role and label.
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { loadHistory, saveResult } from './lib/history';
import { DEFAULT_SETTINGS, loadSettings } from './lib/settings';
import { rulesScore } from './lib/scoring/rules';
import { STRONG_ANSWER, transcriptOf } from './test/helpers';
import type { AttemptResult, Question, Settings } from './types';

vi.mock('./lib/transcribe', () => ({
  transcribe: vi.fn(),
  preloadTranscriber: vi.fn(() => Promise.resolve()),
  testTranscription: vi.fn(() => Promise.resolve({ ok: true, message: 'Connected' })),
}));

function seedSettings(over: Partial<Settings> = {}) {
  localStorage.setItem(
    'ivp.settings.v1',
    JSON.stringify({ ...DEFAULT_SETTINGS, onboarded: true, scoring: 'rules', ...over }),
  );
}

const question: Question = {
  id: 'q-test',
  text: 'Describe a time you solved a hard problem.',
  category: 'behavioral',
  competencies: ['problem_solving'],
};

function savedResult(id: string): AttemptResult {
  const transcript = transcriptOf(STRONG_ANSWER);
  return {
    id,
    question,
    createdAt: Date.now(),
    attemptsUsed: 1,
    durationSec: 45,
    transcript,
    evaluation: rulesScore({ question, transcript, gaze: null, durationSec: 45, maxSeconds: 90 }),
  };
}

describe('Settings page', () => {
  async function openSettings() {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Settings' });
    return user;
  }

  it('changes eye contact tracking, persists it on Save and returns Home', async () => {
    seedSettings({ enableGaze: true });
    const user = await openSettings();
    const gaze = screen.getByRole('combobox', { name: 'Track eye contact' });
    expect(gaze).toHaveValue('on');

    await user.selectOptions(gaze, 'off');
    expect(loadSettings().enableGaze).toBe(true); // not saved yet
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(loadSettings().enableGaze).toBe(false);
    expect(await screen.findByRole('button', { name: 'Start practice' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('clamps out-of-range numbers when saving', async () => {
    seedSettings();
    const user = await openSettings();
    const answer = screen.getByRole('spinbutton', { name: /Answer time/ });
    await user.clear(answer);
    await user.type(answer, '500');
    const attempts = screen.getByRole('spinbutton', { name: /Attempts per question/ });
    await user.clear(attempts);
    await user.type(attempts, '9');
    // Browsers block a normal submit for out-of-range numbers; submit directly to check the clamp.
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);
    expect(loadSettings()).toMatchObject({ answerSeconds: 120, maxAttempts: 3 });
  });

  it('Reset restores defaults but keeps the user onboarded', async () => {
    seedSettings({ prepSeconds: 10, enableGaze: false });
    const user = await openSettings();
    expect(screen.getByRole('spinbutton', { name: /Prep time/ })).toHaveValue(10);

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('spinbutton', { name: /Prep time/ })).toHaveValue(DEFAULT_SETTINGS.prepSeconds);
    expect(screen.getByRole('combobox', { name: 'Track eye contact' })).toHaveValue('on');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(loadSettings()).toMatchObject({ onboarded: true, prepSeconds: DEFAULT_SETTINGS.prepSeconds });
  });

  it('lists the camera and microphone devices', async () => {
    seedSettings();
    await openSettings();
    const camera = await screen.findByRole('combobox', { name: /Camera/ });
    expect(await within(camera).findByRole('option', { name: 'External Webcam' })).toBeInTheDocument();
    expect(
      await within(screen.getByRole('combobox', { name: /Microphone/ })).findByRole('option', {
        name: 'Built-in Mic',
      }),
    ).toBeInTheDocument();
  });

  it('Back goes Home, asking first when there are unsaved changes', async () => {
    seedSettings();
    const user = await openSettings();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('button', { name: 'Start practice' })).toBeInTheDocument();
    expect(window.confirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Track eye contact' }), 'off');
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });
});

describe('History page', () => {
  it('lists saved answers with their verdict and opens one in Results', async () => {
    seedSettings();
    saveResult(savedResult('h1'));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'History' }));
    const item = await screen.findByRole('button', { name: new RegExp(question.text) });
    expect(item).toHaveTextContent(savedResult('x').evaluation.verdict);
    await user.click(item);
    expect(await screen.findByRole('button', { name: 'Next question' })).toBeInTheDocument();
    expect(screen.getByText(question.text)).toBeInTheDocument();
  });

  it('Clear history asks first, then empties the list', async () => {
    seedSettings();
    saveResult(savedResult('h1'));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'History' }));

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await user.click(await screen.findByRole('button', { name: 'Clear history' }));
    expect(loadHistory()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Clear history' }));
    expect(await screen.findByText('No answers yet.')).toBeInTheDocument();
    expect(loadHistory()).toEqual([]);
  });

  it('Back returns Home', async () => {
    seedSettings();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'History' }));
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('button', { name: 'Start practice' })).toBeInTheDocument();
  });
});
