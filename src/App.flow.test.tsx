// Integration: the practice flow through the real App, with real rules scoring.
// Only the heavy boundaries are mocked: transcription, eye-contact tracking and the browser media APIs.
import 'fake-indexeddb/auto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { loadHistory } from './lib/history';
import { DEFAULT_SETTINGS } from './lib/settings';
import { transcribe } from './lib/transcribe';
import { RED_FLAG_ANSWER, STRONG_ANSWER, transcriptOf } from './test/helpers';
import questions from './data/questions.json';
import type { Settings } from './types';

const QUESTION_COUNT = questions.length;

vi.mock('./lib/transcribe', () => ({
  transcribe: vi.fn(),
  preloadTranscriber: vi.fn(() => Promise.resolve()),
  testTranscription: vi.fn(() => Promise.resolve({ ok: true, message: 'Connected' })),
}));

vi.mock('./lib/gaze', () => ({
  createGazeTracker: vi.fn(() =>
    Promise.resolve({
      start: vi.fn(),
      stop: vi.fn(() => ({
        durationSec: 45,
        sampleCount: 100,
        faceDetectedPct: 98,
        eyeContactPct: 71,
        lookAwayEvents: 2,
        longestLookAwaySec: 1.5,
        multipleFacesDetected: false,
        timeline: [
          { t: 0, looking: true },
          { t: 250, looking: false },
        ],
      })),
      onSample: null,
      dispose: vi.fn(),
    }),
  ),
}));

function seedSettings(over: Partial<Settings> = {}) {
  const s: Settings = {
    ...DEFAULT_SETTINGS,
    onboarded: true,
    scoring: 'rules',
    transcription: 'local',
    prepSeconds: 0,
    ...over,
  };
  localStorage.setItem('ivp.settings.v1', JSON.stringify(s));
}

type User = ReturnType<typeof userEvent.setup>;

/** Home, setup check, interview: records one take and stops it. */
async function startAndRecord(user: User) {
  await user.click(screen.getByRole('button', { name: 'Start practice' }));
  await screen.findByRole('heading', { name: 'Check your setup' });
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(await screen.findByRole('button', { name: 'Stop' }));
  await screen.findByRole('button', { name: /Retake/ });
}

beforeEach(() => {
  vi.mocked(transcribe).mockReset();
});

describe('practice flow', () => {
  it('goes from Home through setup, recording, retake, analysis and results into History', async () => {
    seedSettings();
    vi.mocked(transcribe).mockResolvedValue(transcriptOf(STRONG_ANSWER));
    // Pin the random question to the teammate one so the verdict for this answer is stable.
    vi.spyOn(Math, 'random').mockReturnValue(11.5 / QUESTION_COUNT);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Start practice' }));

    // The setup check lists the devices from enumerateDevices.
    await screen.findByRole('heading', { name: 'Check your setup' });
    const camera = await screen.findByRole('combobox', { name: /Camera/ });
    await waitFor(() =>
      expect(within(camera).getByRole('option', { name: 'External Webcam' })).toBeInTheDocument(),
    );
    expect(within(camera).getByRole('option', { name: 'Front Camera' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('combobox', { name: /Microphone/ })).getByRole('option', {
        name: 'Built-in Mic',
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Prep is 0 seconds, so recording starts straight away.
    expect(await screen.findByRole('timer', { name: 'Answer time left' })).toBeInTheDocument();
    expect(screen.getByText('Attempt 1 of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop' }));

    // Review, then retake once.
    const retake = await screen.findByRole('button', { name: 'Retake (2 left)' });
    expect(screen.getByLabelText('Playback of your recorded answer')).toBeInTheDocument();
    await user.click(retake);
    expect(await screen.findByText('Attempt 2 of 3')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(await screen.findByRole('button', { name: 'Retake (1 left)' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Submit this answer' }));

    // Results, scored by the real rules engine from the mocked transcript.
    await screen.findByRole('button', { name: 'Next question' });
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/^(Positive|Very positive)$/)).toBeInTheDocument();
    expect(screen.getByText('Scored by built-in rules')).toBeInTheDocument();
    const quotes = Array.from(document.querySelectorAll('blockquote')).map((b) => b.textContent ?? '');
    expect(quotes.length).toBeGreaterThan(0);
    for (const q of quotes) expect(STRONG_ANSWER).toContain(q);
    expect(screen.getByText(/attempt 2/)).toBeInTheDocument();
    expect(screen.queryByText('Red flags')).not.toBeInTheDocument();
    expect(screen.getByText('71%')).toBeInTheDocument(); // eye contact from the mocked tracker
    expect(screen.getByText('Transcript')).toBeInTheDocument();

    // The video area shows the stored recording, or its fallback message.
    await waitFor(() =>
      expect(
        document.querySelector('.report-video video') ?? screen.queryByText('Recording not available'),
      ).toBeTruthy(),
    );

    // It was saved, and History lists it.
    const saved = loadHistory();
    expect(saved).toHaveLength(1);
    expect(saved[0].attemptsUsed).toBe(2);
    await user.click(screen.getByRole('button', { name: 'History' }));
    const item = await screen.findByRole('button', { name: new RegExp(saved[0].evaluation.verdict) });
    expect(item).toHaveTextContent(saved[0].question.text);
    await user.click(item);
    expect(await screen.findByRole('button', { name: 'Next question' })).toBeInTheDocument();
  });

  it('gives a red-flag answer a Negative verdict and a red flag block', async () => {
    seedSettings();
    vi.mocked(transcribe).mockResolvedValue(transcriptOf(RED_FLAG_ANSWER));
    const user = userEvent.setup();
    render(<App />);
    await startAndRecord(user);
    await user.click(screen.getByRole('button', { name: 'Submit this answer' }));

    await screen.findByRole('button', { name: 'Next question' });
    expect(screen.getByText(/^(Negative|Very negative)$/)).toBeInTheDocument();
    const block = screen.getByRole('alert');
    expect(within(block).getByRole('heading', { name: 'Red flags' })).toBeInTheDocument();
    expect(
      within(block).getByText('I scam people when I get the chance because it is easy money.'),
    ).toBeInTheDocument();
    expect(loadHistory()[0].evaluation.verdict).toMatch(/negative/i);
  });

  it('shows an error with Retry when transcription fails, then recovers', async () => {
    seedSettings();
    vi.mocked(transcribe)
      .mockRejectedValueOnce(new Error('decoder exploded'))
      .mockResolvedValue(transcriptOf(STRONG_ANSWER));
    const user = userEvent.setup();
    render(<App />);
    await startAndRecord(user);
    await user.click(screen.getByRole('button', { name: 'Submit this answer' }));

    expect(await screen.findByText('decoder exploded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('button', { name: 'Next question' });
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it('disables Retake when no attempts are left', async () => {
    seedSettings({ maxAttempts: 1 });
    const user = userEvent.setup();
    render(<App />);
    await startAndRecord(user);
    expect(screen.getByRole('button', { name: 'Retake (0 left)' })).toBeDisabled();
  });

  it('asks before leaving a recording and goes Home when confirmed', async () => {
    seedSettings();
    const user = userEvent.setup();
    render(<App />);
    await startAndRecord(user);
    await user.click(screen.getByRole('button', { name: 'Exit' }));
    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Exit' }));
    expect(await screen.findByRole('button', { name: 'Start practice' })).toBeInTheDocument();
  });

  it('shows a clear error and blocks Continue when the camera is blocked', async () => {
    seedSettings();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Start practice' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/blocked/i);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });
});
