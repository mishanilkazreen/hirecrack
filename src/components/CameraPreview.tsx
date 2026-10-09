import { useEffect, useRef } from 'react';

interface Props {
  stream: MediaStream | null;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  children?: React.ReactNode;
}

/** Mirrored, muted live preview of a MediaStream. Children render as an overlay. */
export default function CameraPreview({ stream, videoRef, children }: Props) {
  const ownRef = useRef<HTMLVideoElement | null>(null);
  const ref = videoRef ?? ownRef;

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) video.play().catch(() => undefined); // autoplay can be refused; the preview just stays paused
  }, [stream, ref]);

  return (
    <div className="video-frame">
      <video ref={ref} className="mirror" muted playsInline aria-label="Camera preview" />
      {children}
    </div>
  );
}
