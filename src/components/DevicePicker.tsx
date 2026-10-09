import { useEffect, useRef, useState } from 'react';
import { playTestTone, supportsSinkId, useCameraTest, useDevices, useMicTest } from '../lib/media';

export interface DeviceIds {
  cameraId: string;
  micId: string;
  speakerId: string;
}

interface Props {
  value: DeviceIds;
  onChange: (next: DeviceIds) => void;
  /** True once camera/mic access is already granted. When omitted, the picker asks for access itself. */
  granted?: boolean;
  /** Hide the camera and microphone Test buttons. Defaults to true when `granted` is passed, since that page already shows a live preview. */
  hideInputTests?: boolean;
}

/** Camera, microphone and speaker dropdowns. */
export default function DevicePicker({
  value,
  onChange,
  granted,
  hideInputTests = granted !== undefined,
}: Props) {
  const [asked, setAsked] = useState(false);

  // Device names are blank until the user has granted access, so open and release a stream once.
  useEffect(() => {
    if (granted !== undefined || !navigator.mediaDevices?.getUserMedia) return;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((s) => {
        s.getTracks().forEach((t) => t.stop());
        if (!cancelled) setAsked(true);
      })
      .catch(() => !cancelled && setAsked(true));
    return () => {
      cancelled = true;
    };
  }, [granted]);

  const devices = useDevices(granted ?? asked);
  const canSink = supportsSinkId();
  const [testing, setTesting] = useState(false);
  const camera = useCameraTest(value.cameraId);
  const mic = useMicTest(value.micId, value.speakerId);
  const previewRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = camera.stream;
  }, [camera.stream]);

  const test = async () => {
    setTesting(true);
    try {
      await playTestTone(value.speakerId);
    } finally {
      window.setTimeout(() => setTesting(false), 800);
    }
  };

  return (
    <div className="stack">
      <Select
        label="Camera"
        value={value.cameraId}
        list={devices.cameras}
        fallback="Camera"
        onChange={(cameraId) => onChange({ ...value, cameraId })}
        action={
          !hideInputTests && (
            <button type="button" className="btn btn-sm" onClick={camera.toggle}>
              {camera.on ? 'Stop' : 'Test'}
            </button>
          )
        }
        below={
          <>
            {camera.on && (
              <video
                ref={previewRef}
                className="device-preview"
                autoPlay
                muted
                playsInline
                aria-label="Camera preview"
              />
            )}
            {camera.error && <span className="small device-msg">{camera.error}</span>}
          </>
        }
      />
      <Select
        label="Microphone"
        value={value.micId}
        list={devices.mics}
        fallback="Microphone"
        onChange={(micId) => onChange({ ...value, micId })}
        action={
          !hideInputTests && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void mic.start()}
              disabled={mic.phase !== 'idle'}
            >
              {mic.phase === 'recording' ? 'Recording…' : mic.phase === 'playing' ? 'Playing…' : 'Test'}
            </button>
          )
        }
        below={
          <>
            {mic.phase === 'recording' && (
              <div
                className="bar"
                role="meter"
                aria-label="Microphone level"
                aria-valuemin={0}
                aria-valuemax={1}
                aria-valuenow={mic.level}
              >
                <div className="bar-fill" style={{ width: `${Math.round(mic.level * 100)}%` }} />
              </div>
            )}
            {mic.error && <span className="small device-msg">{mic.error}</span>}
          </>
        }
      />
      {canSink && (
        <div className="field">
          <Select
            label="Speaker"
            value={value.speakerId}
            list={devices.speakers}
            fallback="Speaker"
            onChange={(speakerId) => onChange({ ...value, speakerId })}
            action={
              <button type="button" className="btn btn-sm" onClick={() => void test()} disabled={testing}>
                {testing ? 'Playing…' : 'Test'}
              </button>
            }
          />
        </div>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  list,
  fallback,
  onChange,
  action,
  below,
}: {
  label: string;
  value: string;
  list: MediaDeviceInfo[];
  fallback: string;
  onChange: (id: string) => void;
  action?: React.ReactNode;
  below?: React.ReactNode;
}) {
  // A saved device that is no longer plugged in shows as the default.
  const current = list.some((d) => d.deviceId === value) ? value : '';
  const real = list.filter((d) => d.deviceId !== 'default' && d.deviceId !== '');
  return (
    <label className="field">
      <span className="label">{label}</span>
      <span className="select-row">
        <select value={current} onChange={(e) => onChange(e.target.value)}>
          <option value="">System default</option>
          {real.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `${fallback} ${i + 1}`}
            </option>
          ))}
        </select>
        {action}
      </span>
      {below}
    </label>
  );
}
