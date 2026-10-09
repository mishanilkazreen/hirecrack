import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixWebmDuration, startRecorder, supportsSinkId } from './media';

class FakeRecorder {
  static supported: string[] = [];
  static last: FakeRecorder | null = null;
  static isTypeSupported = (t: string) => FakeRecorder.supported.includes(t);
  state: 'inactive' | 'recording' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    public stream: unknown,
    public options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? '';
    FakeRecorder.last = this;
  }
  start = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['abc']) });
    this.onstop?.();
  });
}

const stream = {} as MediaStream;

afterEach(() => {
  vi.unstubAllGlobals();
  FakeRecorder.supported = [];
  FakeRecorder.last = null;
});

describe('startRecorder mime type selection', () => {
  it('prefers vp9 webm when supported', () => {
    FakeRecorder.supported = ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'];
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    startRecorder(stream);
    expect(FakeRecorder.last!.options).toEqual({ mimeType: 'video/webm;codecs=vp9,opus' });
  });

  it('falls through the candidate list in order', () => {
    FakeRecorder.supported = ['video/webm', 'video/mp4'];
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    startRecorder(stream);
    expect(FakeRecorder.last!.options?.mimeType).toBe('video/webm');
  });

  it('uses mp4 where it is the only option (Safari)', () => {
    FakeRecorder.supported = ['video/mp4'];
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    startRecorder(stream);
    expect(FakeRecorder.last!.options?.mimeType).toBe('video/mp4');
  });

  it('lets the browser choose when nothing matches', () => {
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    startRecorder(stream);
    expect(FakeRecorder.last!.options).toBeUndefined();
  });
});

describe('startRecorder', () => {
  it('collects chunks every second and returns one blob with the recorder type', async () => {
    FakeRecorder.supported = ['video/webm'];
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    const rec = startRecorder(stream);
    expect(FakeRecorder.last!.start).toHaveBeenCalledWith(1000);
    const blob = await rec.stop();
    expect(blob.type).toBe('video/webm');
    expect(blob.size).toBe(3);
  });

  it('resolves immediately if the recorder already stopped', async () => {
    FakeRecorder.supported = ['video/webm'];
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    const rec = startRecorder(stream);
    FakeRecorder.last!.state = 'inactive';
    const blob = await rec.stop();
    expect(FakeRecorder.last!.stop).not.toHaveBeenCalled();
    expect(blob.size).toBe(0);
  });
});

describe('supportsSinkId', () => {
  it('is false when HTMLMediaElement is missing', () => {
    expect(supportsSinkId()).toBe(false); // node environment
  });

  it('detects setSinkId on the prototype', () => {
    vi.stubGlobal('HTMLMediaElement', { prototype: { setSinkId: () => undefined } });
    expect(supportsSinkId()).toBe(true);
    vi.stubGlobal('HTMLMediaElement', { prototype: {} });
    expect(supportsSinkId()).toBe(false);
  });
});

describe('fixWebmDuration', () => {
  function fakeVideo(duration: number) {
    const listeners = new Map<string, () => void>();
    const video = {
      duration,
      currentTime: 5,
      addEventListener: vi.fn((n: string, fn: () => void) => listeners.set(n, fn)),
      removeEventListener: vi.fn((n: string) => listeners.delete(n)),
    };
    return { video, listeners };
  }
  const run = (video: object) => fixWebmDuration({ currentTarget: video } as never);

  it('does nothing when the duration is already known', () => {
    const { video } = fakeVideo(12.5);
    run(video);
    expect(video.addEventListener).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(5);
  });

  it('seeks far ahead when the duration is Infinity, then rewinds once it is known', () => {
    const { video, listeners } = fakeVideo(Infinity);
    run(video);
    expect(video.currentTime).toBe(1e101);
    listeners.get('durationchange')!();
    expect(video.currentTime).toBe(0);
    expect(video.removeEventListener).toHaveBeenCalledWith('durationchange', expect.any(Function));
    expect(listeners.size).toBe(0);
  });

  it('also repairs a NaN duration', () => {
    const { video } = fakeVideo(NaN);
    run(video);
    expect(video.currentTime).toBe(1e101);
  });
});
