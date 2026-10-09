import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/settings';
import type { Question, Settings } from '../types';
import Interview from './Interview';

const question: Question = {
  id: 'q1',
  text: 'Tell me about a time you led a team.',
  category: 'behavioral',
  competencies: ['leadership'],
};

const settings = (over: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  enableGaze: false,
  prepSeconds: 5,
  answerSeconds: 60,
  ...over,
});

afterEach(() => vi.useRealTimers());

/** Lets the mocked getUserMedia promise chain settle while fake timers are active. */
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

describe('Interview timers', () => {
  it('counts down the prep time, then starts recording by itself', async () => {
    vi.useFakeTimers();
    render(<Interview question={question} settings={settings()} onSubmit={vi.fn()} onExit={vi.fn()} />);
    await flush();

    expect(screen.getByRole('timer', { name: 'Preparation time left' })).toHaveTextContent('0:05');
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByRole('timer', { name: 'Preparation time left' })).toHaveTextContent('0:02');

    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(screen.getByRole('timer', { name: 'Answer time left' })).toBeInTheDocument();
    expect(screen.getByText('Recording')).toBeInTheDocument();
  });

  it('"Start recording now" skips the rest of the prep time', async () => {
    vi.useFakeTimers();
    render(<Interview question={question} settings={settings()} onSubmit={vi.fn()} onExit={vi.fn()} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Start recording now' }));
    expect(screen.getByRole('timer', { name: 'Answer time left' })).toHaveTextContent('1:00');
  });

  it('stops the recording by itself when the answer time runs out', async () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();
    render(
      <Interview
        question={question}
        settings={settings({ prepSeconds: 0 })}
        onSubmit={onSubmit}
        onExit={vi.fn()}
      />,
    );
    await flush();
    expect(screen.getByRole('timer', { name: 'Answer time left' })).toHaveTextContent('1:00');

    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(screen.getByRole('timer', { name: 'Answer time left' })).toHaveTextContent('0:30');

    await act(() => vi.advanceTimersByTimeAsync(31_000));
    expect(screen.getByRole('button', { name: /Submit this answer/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Submit this answer' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const take = onSubmit.mock.calls[0][0];
    expect(take.attemptsUsed).toBe(1);
    expect(take.durationSec).toBeGreaterThanOrEqual(60);
    expect(take.gaze).toBeNull();
    expect(take.blob).toBeInstanceOf(Blob);
  });

  it('clamps an out-of-range answer time to the supported range', async () => {
    vi.useFakeTimers();
    render(
      <Interview
        question={question}
        settings={settings({ prepSeconds: 0, answerSeconds: 5000 })}
        onSubmit={vi.fn()}
        onExit={vi.fn()}
      />,
    );
    await flush();
    expect(screen.getByRole('timer', { name: 'Answer time left' })).toHaveTextContent('2:00');
  });
});
