import { vi } from 'vitest';
import type { Transcript } from '../types';

export const STRONG_ANSWER =
  'Last spring on my team project, one teammate kept missing deadlines and the rest of us were frustrated. ' +
  'I asked him for a quiet coffee and listened to what was going on, and it turned out he was working night shifts. ' +
  'I split the work so his tasks were smaller, set up a shared tracker, and agreed weekly check-ins with him. ' +
  'As a result we delivered the project two days early and our final mark improved by 12 percent. ' +
  'He later thanked me, and we worked together again on the next module, which taught me to ask before assuming.';

export const RED_FLAG_ANSWER =
  'I scam people when I get the chance because it is easy money. ' +
  'Last year I worked on a big group project, I planned the schedule, wrote the report, and we got 90 percent. ' +
  'As a result the team did very well and I built the final presentation too.';

export function transcriptOf(text: string): Transcript {
  return { text, segments: [], durationSec: 45, engine: 'test' };
}

export const DEVICES = [
  { deviceId: 'cam-1', kind: 'videoinput', label: 'Front Camera', groupId: 'g' },
  { deviceId: 'cam-2', kind: 'videoinput', label: 'External Webcam', groupId: 'g' },
  { deviceId: 'mic-1', kind: 'audioinput', label: 'Built-in Mic', groupId: 'g' },
  { deviceId: 'spk-1', kind: 'audiooutput', label: 'Desk Speakers', groupId: 'g' },
] as unknown as MediaDeviceInfo[];

export function fakeStream(): MediaStream {
  const track = (kind: string) => ({ kind, stop: vi.fn() });
  const tracks = [track('video'), track('audio')];
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  } as unknown as MediaStream;
}

export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = () => true;
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'video/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    FakeMediaRecorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['fake-video-bytes'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

class FakeAudioContext {
  currentTime = 0;
  createAnalyser = () => ({ fftSize: 0, getByteTimeDomainData: (a: Uint8Array) => a.fill(128) });
  createMediaStreamSource = () => ({ connect: () => undefined });
  close = () => Promise.resolve();
}

/** Camera, recorder, audio, playback and object-URL stubs for jsdom. Called before every test. */
export function installBrowserStubs() {
  const md = {
    getUserMedia: vi.fn(() => Promise.resolve(fakeStream())),
    enumerateDevices: vi.fn(() => Promise.resolve(DEVICES)),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(navigator, 'mediaDevices', { value: md, configurable: true, writable: true });
  FakeMediaRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(window, 'AudioContext', {
    value: FakeAudioContext,
    configurable: true,
    writable: true,
  });

  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:fake/${++n}`);
  URL.revokeObjectURL = vi.fn();
  window.confirm = vi.fn(() => true);
  return md;
}
