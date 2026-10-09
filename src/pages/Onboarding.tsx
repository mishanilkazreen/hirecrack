import { useState } from 'react';
import EngineSetup, { useEnginesReady } from '../components/EngineSetup';
import type { Settings } from '../types';
import '../report.css';

interface Props {
  settings: Settings;
  onDone: (next: Settings) => void;
}

export default function Onboarding({ settings, onDone }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const ready = useEnginesReady(draft);

  return (
    <section className="page narrow onboarding">
      <img className="onboarding-logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="HireCrack" />
      <h2>Set up HireCrack</h2>
      <p className="muted">Choose how your answers are transcribed and scored. You can change this later.</p>
      <div className="card">
        <EngineSetup settings={draft} onChange={setDraft} />
      </div>
      <div className="row onboarding-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ready}
          onClick={() => onDone({ ...draft, onboarded: true })}
        >
          Continue
        </button>
        <button
          type="button"
          className="btn-link"
          onClick={() => onDone({ ...draft, scoring: 'rules', transcription: 'local', onboarded: true })}
        >
          Skip for now
        </button>
      </div>
    </section>
  );
}
