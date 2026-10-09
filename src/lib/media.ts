import { useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';

const MIC_LEVEL_EPSILON = 0.02;

// In order of preference. Safari only supports mp4.
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

function mediaErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera or microphone access was blocked. Allow access in your browser or system settings, then reload and try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera or microphone was found. Connect one and try again.';
    case 'NotReadableError':
      return 'Your camera or microphone is in use by another application. Close it and try again.';
    default: {
      const msg = (e as Error)?.message;
      return `Could not access camera and microphone${msg ? `: ${msg}` : '.'}`;
    }
  }
}

function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Opens the camera and mic, and releases them on unmount. Falls back to the default device if a chosen one is gone. */
export function useMediaStream(
  cameraId = '',
  micId = '',
): { stream: MediaStream | null; error: string | null; loading: boolean } {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let acquired: MediaStream | null = null;
    setLoading(true);
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This environment does not support camera access.');
      setLoading(false);
      return;
    }
    const open = (video: MediaTrackConstraints, audio: MediaTrackConstraints) =>
      navigator.mediaDevices.getUserMedia({ video, audio });
    const videoBase: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
    const audioBase: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true };
    const chosen = () =>
      open(
        cameraId ? { ...videoBase, deviceId: { exact: cameraId } } : { ...videoBase, facingMode: 'user' },
        micId ? { ...audioBase, deviceId: { exact: micId } } : audioBase,
      );
    const fallback = () => open({ ...videoBase, facingMode: 'user' }, audioBase);
    chosen()
      .catch((e) => {
        const name = (e as { name?: string })?.name;
        if ((cameraId || micId) && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
          return fallback();
        }
        throw e;
      })
      .then((s) => {
        if (cancelled) return stopStream(s);
        acquired = s;
        setStream(s);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(mediaErrorMessage(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
      stopStream(acquired);
      setStream(null);
    };
  }, [cameraId, micId]);

  return { stream, error, loading };
}

export interface Devices {
  cameras: MediaDeviceInfo[];
  mics: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

/** Lists cameras, mics and speakers. Call after permission is granted so labels are filled in. */
export function useDevices(ready: boolean): Devices {
  const [devices, setDevices] = useState<Devices>({ cameras: [], mics: [], speakers: [] });
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!ready || !md?.enumerateDevices) return;
    let cancelled = false;
    const refresh = () =>
      md
        .enumerateDevices()
        .then((all) => {
          if (cancelled) return;
          setDevices({
            cameras: all.filter((d) => d.kind === 'videoinput'),
            mics: all.filter((d) => d.kind === 'audioinput'),
            speakers: all.filter((d) => d.kind === 'audiooutput'),
          });
        })
        .catch(() => undefined);
    void refresh();
    md.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      md.removeEventListener('devicechange', refresh);
    };
  }, [ready]);
  return devices;
}

type SinkElement = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };

/** True when the browser can route playback to a chosen output device. */
export function supportsSinkId(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

/** Routes a media element's audio to the chosen speaker. Empty id means the system default. */
export function useSinkId(ref: React.RefObject<HTMLMediaElement | null>, speakerId: string): void {
  // The element may mount after this hook runs (e.g. once a video loads), so re-apply on every render.
  useEffect(() => {
    const el = ref.current as SinkElement | null;
    if (!el?.setSinkId) return;
    el.setSinkId(speakerId || 'default').catch(() => undefined); // device gone: keep the default output
  });
}

/** Plays a short tone through the chosen speaker. */
export async function playTestTone(speakerId: string): Promise<void> {
  const el = new Audio() as SinkElement;
  if (speakerId && el.setSinkId) await el.setSinkId(speakerId).catch(() => undefined);
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const dest = ctx.createMediaStreamDestination();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 660;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7);
  osc.connect(gain).connect(dest);
  el.srcObject = dest.stream;
  osc.start();
  osc.stop(ctx.currentTime + 0.75);
  await el.play().catch(() => undefined);
  osc.onended = () => {
    el.pause();
    el.srcObject = null;
    void ctx.close();
  };
}

/** Live microphone level, 0 to 1. */
export function useMicLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) return;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let last = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      const next = Math.min(1, peak * 2); // speech rarely peaks near full scale, so boost it
      if (Math.abs(next - last) > MIC_LEVEL_EPSILON) {
        // skip re-renders for tiny changes
        last = next;
        setLevel(next);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      void ctx.close();
    };
  }, [stream]);
  return level;
}

export interface ActiveRecorder {
  stop(): Promise<Blob>;
}

/** Starts recording the stream, collecting a chunk every second. */
export function startRecorder(stream: MediaStream): ActiveRecorder {
  const mimeType = pickMimeType();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  rec.start(1000);
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        const type = rec.mimeType || mimeType || 'video/webm';
        if (rec.state === 'inactive') return resolve(new Blob(chunks, { type }));
        rec.onstop = () => resolve(new Blob(chunks, { type }));
        rec.stop();
      }),
  };
}

/** Object URL for a blob, revoked when the blob changes or the component unmounts. */
export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = blob ? URL.createObjectURL(blob) : null;
    setUrl(u);
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [blob]);
  return url;
}

// MediaRecorder's webm output has no duration header, so the player shows 0:00 and can't seek.
// Seeking far past the end makes the browser scan the file and work out the real duration.
export function fixWebmDuration(e: SyntheticEvent<HTMLVideoElement>) {
  const video = e.currentTarget;
  if (video.duration !== Infinity && !Number.isNaN(video.duration)) return;
  const rewind = () => {
    video.removeEventListener('durationchange', rewind);
    video.currentTime = 0;
  };
  video.addEventListener('durationchange', rewind);
  video.currentTime = 1e101;
}

const MIC_TEST_MS = 3000;

function deviceErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Access blocked.';
  if (name === 'NotReadableError') return 'Device in use.';
  return 'Device unavailable.';
}

/** Opens one kind of device, falling back to the system default if the chosen one is gone. */
async function openDevice(kind: 'video' | 'audio', deviceId: string): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
  const get = (id: string) =>
    navigator.mediaDevices.getUserMedia({ [kind]: id ? { deviceId: { exact: id } } : true });
  try {
    return await get(deviceId);
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (deviceId && (name === 'OverconstrainedError' || name === 'NotFoundError')) return get('');
    throw e;
  }
}

/** Toggleable live camera preview. Stops on toggle, device change and unmount. */
export function useCameraTest(cameraId: string) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    let acquired: MediaStream | null = null;
    setError(null);
    openDevice('video', cameraId)
      .then((s) => {
        if (cancelled) return stopStream(s);
        acquired = s;
        setStream(s);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(deviceErrorMessage(e));
        setOn(false);
      });
    return () => {
      cancelled = true;
      stopStream(acquired);
      setStream(null);
    };
  }, [on, cameraId]);

  // Changing the camera ends the test.
  useEffect(() => {
    setOn(false);
  }, [cameraId]);

  return {
    stream,
    error,
    on,
    toggle: () => {
      setError(null);
      setOn((v) => !v);
    },
  };
}

export type MicTestPhase = 'idle' | 'recording' | 'playing';

/** Records a few seconds from the mic, then plays it back through the chosen speaker. */
export function useMicTest(micId: string, speakerId: string) {
  const [phase, setPhase] = useState<MicTestPhase>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cleanup = useRef<() => void>(() => undefined);
  const level = useMicLevel(stream);

  const stop = () => {
    cleanup.current();
    cleanup.current = () => undefined;
    setStream(null);
    setPhase('idle');
  };

  // Ends the test on unmount or when the mic or speaker changes.
  useEffect(() => stop, [micId, speakerId]);

  const start = async () => {
    if (phase !== 'idle') return;
    setError(null);
    let cancelled = false;
    let timer = 0;
    let url: string | null = null;
    let audio: SinkElement | null = null;
    let mic: MediaStream | null = null;
    cleanup.current = () => {
      cancelled = true;
      window.clearTimeout(timer);
      stopStream(mic);
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
      }
      if (url) URL.revokeObjectURL(url);
    };
    try {
      mic = await openDevice('audio', micId);
      if (cancelled) return stopStream(mic);
      if (typeof MediaRecorder === 'undefined') throw new Error('unsupported');
      setStream(mic);
      setPhase('recording');
      const rec = new MediaRecorder(mic);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      rec.onstop = () => {
        if (cancelled) return;
        stopStream(mic);
        setStream(null);
        url = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }));
        const el = new Audio(url) as SinkElement;
        audio = el;
        const done = () => !cancelled && stop();
        el.onended = done;
        el.onerror = done;
        void (async () => {
          if (speakerId && el.setSinkId) await el.setSinkId(speakerId).catch(() => undefined);
          if (cancelled) return;
          setPhase('playing');
          await el.play().catch(done);
        })();
      };
      rec.start();
      timer = window.setTimeout(() => rec.state !== 'inactive' && rec.stop(), MIC_TEST_MS);
    } catch (e) {
      if (cancelled) return;
      stop();
      setError(deviceErrorMessage(e));
    }
  };

  return { phase, level, error, start };
}
