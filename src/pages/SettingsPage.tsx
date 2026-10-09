import { useState } from 'react';
import BackButton from '../components/BackButton';
import DevicePicker from '../components/DevicePicker';
import EngineSetup from '../components/EngineSetup';
import {
  DEFAULT_SETTINGS,
  MAX_ANSWER_SECONDS,
  MAX_ATTEMPTS,
  MAX_PREP_SECONDS,
  MIN_ANSWER_SECONDS,
  saveSettings,
} from '../lib/settings';
import type { Settings } from '../types';

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onBack: () => void;
}

/** Clamps to [lo, hi]; NaN (an emptied number input) falls back to lo. */
function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}

export default function SettingsPage({ settings, onSave, onBack }: Props) {
  const [draft, setDraft] = useState<Settings>(settings);
  const change = (next: Settings) => setDraft(next);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const back = () => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onBack();
  };
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => change({ ...draft, [key]: value });

  const save = () => {
    const clean: Settings = {
      ...draft,
      prepSeconds: clamp(draft.prepSeconds, 0, MAX_PREP_SECONDS),
      answerSeconds: clamp(draft.answerSeconds, MIN_ANSWER_SECONDS, MAX_ANSWER_SECONDS),
      maxAttempts: clamp(Math.round(draft.maxAttempts), 1, MAX_ATTEMPTS),
    };
    saveSettings(clean);
    onSave(clean);
  };

  // Keep onboarding state so a reset does not send the user back to first-launch setup.
  const reset = () => change({ ...DEFAULT_SETTINGS, onboarded: draft.onboarded });

  return (
    <section className="page narrow">
      <div className="page-head">
        <div className="page-head-main">
          <BackButton onClick={back} />
          <h2>Settings</h2>
        </div>
      </div>
      <form
        className="stack-lg"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <section className="card stack" aria-labelledby="s-engines">
          <h3 id="s-engines">Engines</h3>
          <EngineSetup settings={draft} onChange={change} />
        </section>

        <section className="card stack" aria-labelledby="s-interview">
          <h3 id="s-interview">Interview</h3>
          <NumberField
            label="Prep time (seconds, 0 to skip)"
            min={0}
            max={MAX_PREP_SECONDS}
            step={5}
            value={draft.prepSeconds}
            onChange={(v) => set('prepSeconds', v)}
          />
          <NumberField
            label="Answer time (seconds)"
            min={MIN_ANSWER_SECONDS}
            max={MAX_ANSWER_SECONDS}
            step={15}
            value={draft.answerSeconds}
            onChange={(v) => set('answerSeconds', v)}
          />
          <NumberField
            label="Attempts per question"
            min={1}
            max={MAX_ATTEMPTS}
            step={1}
            value={draft.maxAttempts}
            onChange={(v) => set('maxAttempts', v)}
          />
          <label className="field">
            <span className="label">Track eye contact</span>
            <select
              value={draft.enableGaze ? 'on' : 'off'}
              onChange={(e) => set('enableGaze', e.target.value === 'on')}
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
        </section>

        <section className="card stack" aria-labelledby="s-devices">
          <h3 id="s-devices">Devices</h3>
          <DevicePicker value={draft} onChange={(ids) => change({ ...draft, ...ids })} />
        </section>

        <div className="row">
          <button type="submit" className="btn btn-primary">
            Save
          </button>
          <button type="button" className="btn" onClick={reset}>
            Reset
          </button>
        </div>
      </form>
    </section>
  );
}

function NumberField(p: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span className="label">{p.label}</span>
      <input
        type="number"
        value={Number.isFinite(p.value) ? p.value : ''}
        min={p.min}
        max={p.max}
        step={p.step}
        onChange={(e) => p.onChange(e.target.valueAsNumber)}
      />
    </label>
  );
}
