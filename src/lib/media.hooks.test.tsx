import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeStream } from '../test/helpers';
import { useDevices, useMediaStream, useObjectUrl } from './media';

const named = (name: string) => Object.assign(new Error(name), { name });
const gum = () => vi.mocked(navigator.mediaDevices.getUserMedia);

describe('useMediaStream', () => {
  it('opens the default camera and mic and releases them on unmount', async () => {
    const stream = fakeStream();
    gum().mockResolvedValue(stream);
    const { result, unmount } = renderHook(() => useMediaStream());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.stream).toBe(stream));
    expect(result.current.error).toBeNull();
    const arg = gum().mock.calls[0][0] as MediaStreamConstraints;
    expect(arg.video).toMatchObject({ facingMode: 'user' });
    unmount();
    for (const t of stream.getTracks()) expect(t.stop).toHaveBeenCalled();
  });

  it('asks for the chosen devices exactly', async () => {
    renderHook(() => useMediaStream('cam-2', 'mic-1'));
    await waitFor(() => expect(gum()).toHaveBeenCalled());
    const arg = gum().mock.calls[0][0] as { video: MediaTrackConstraints; audio: MediaTrackConstraints };
    expect(arg.video.deviceId).toEqual({ exact: 'cam-2' });
    expect(arg.audio.deviceId).toEqual({ exact: 'mic-1' });
  });

  it('falls back to the default device when the chosen one is gone', async () => {
    const stream = fakeStream();
    gum().mockRejectedValueOnce(named('OverconstrainedError')).mockResolvedValue(stream);
    const { result } = renderHook(() => useMediaStream('gone', ''));
    await waitFor(() => expect(result.current.stream).toBe(stream));
    expect(gum()).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['NotAllowedError', /blocked/],
    ['NotFoundError', /No camera or microphone/],
    ['NotReadableError', /in use by another application/],
    ['WeirdError', /Could not access camera and microphone: WeirdError/],
  ])('maps %s to a helpful message', async (name, message) => {
    gum().mockRejectedValue(named(name));
    const { result } = renderHook(() => useMediaStream());
    await waitFor(() => expect(result.current.error).toMatch(message));
    expect(result.current.stream).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('reports an environment without camera support', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    const { result } = renderHook(() => useMediaStream());
    await waitFor(() => expect(result.current.error).toMatch(/does not support camera access/));
  });
});

describe('useDevices', () => {
  it('lists devices by kind once ready, and stays empty before that', async () => {
    const { result, rerender } = renderHook(({ ready }) => useDevices(ready), {
      initialProps: { ready: false },
    });
    expect(result.current.cameras).toEqual([]);
    expect(navigator.mediaDevices.enumerateDevices).not.toHaveBeenCalled();
    rerender({ ready: true });
    await waitFor(() => expect(result.current.cameras).toHaveLength(2));
    expect(result.current.mics.map((d) => d.label)).toEqual(['Built-in Mic']);
    expect(result.current.speakers.map((d) => d.label)).toEqual(['Desk Speakers']);
  });
});

describe('useObjectUrl', () => {
  it('creates a URL for a blob and revokes it on unmount', () => {
    const blob = new Blob(['x']);
    const { result, unmount } = renderHook(() => useObjectUrl(blob));
    expect(result.current).toMatch(/^blob:/);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(result.current);
  });

  it('is null without a blob', () => {
    const { result } = renderHook(() => useObjectUrl(null));
    expect(result.current).toBeNull();
    void act;
  });
});
