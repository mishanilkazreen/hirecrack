import { useRef, useState } from 'react';
import questionData from './data/questions.json';
import Topbar from './components/Topbar';
import { saveResult } from './lib/history';
import { loadSettings, saveSettings } from './lib/settings';
import type { AttemptResult, Question, Settings } from './types';
import Analysing from './pages/Analysing';
import History from './pages/History';
import Home from './pages/Home';
import Interview from './pages/Interview';
import type { Take } from './pages/Interview';
import Onboarding from './pages/Onboarding';
import Results from './pages/Results';
import SettingsPage from './pages/SettingsPage';
import SetupCheck from './pages/SetupCheck';

// The JSON is checked against the Question shape in src/data/data.test.ts.
const QUESTIONS = questionData as unknown as Question[];

type Screen = 'home' | 'setup' | 'interview' | 'analysing' | 'results' | 'history' | 'settings';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [question, setQuestion] = useState<Question | null>(null);
  const [take, setTake] = useState<Take | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [interviewKey, setInterviewKey] = useState(0);
  // Whether the camera/mic check has been passed this session, so we only show it once.
  const setupDone = useRef(false);
  const askedIds = useRef<Set<string>>(new Set());

  // Random question, avoiding repeats until the whole pool has been asked.
  const pickQuestion = (): Question | null => {
    if (QUESTIONS.length === 0) return null;
    let fresh = QUESTIONS.filter((q) => !askedIds.current.has(q.id));
    if (fresh.length === 0) {
      askedIds.current.clear();
      fresh = QUESTIONS;
    }
    const picked = fresh[Math.floor(Math.random() * fresh.length)];
    askedIds.current.add(picked.id);
    return picked;
  };

  // Remounts Interview (via its key) so every attempt starts from a clean state.
  const beginInterview = (next: Question | null) => {
    if (!next) return;
    setQuestion(next);
    setTake(null);
    setInterviewKey((k) => k + 1);
    setScreen('interview');
  };

  const start = () => {
    const picked = pickQuestion();
    if (!picked) return;
    if (setupDone.current) {
      beginInterview(picked);
    } else {
      setQuestion(picked);
      setScreen('setup');
    }
  };

  const update = (next: Settings) => {
    saveSettings(next);
    setSettings(next);
  };

  const noop = () => undefined;

  if (!settings.onboarded) {
    return (
      <div className="app">
        <Topbar bare page="" onHome={noop} onHistory={noop} onSettings={noop} />
        <main>
          <Onboarding settings={settings} onDone={update} />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="app">
      <Topbar
        page={screen}
        onHome={() => setScreen('home')}
        onHistory={() => setScreen('history')}
        onSettings={() => setScreen('settings')}
      />
      <main>
        {screen === 'home' && <Home onStart={start} />}
        {screen === 'setup' && (
          <SetupCheck
            settings={settings}
            onSettings={update}
            onBack={() => setScreen('home')}
            onContinue={() => {
              setupDone.current = true;
              beginInterview(question);
            }}
          />
        )}
        {screen === 'interview' && question && (
          <Interview
            key={interviewKey}
            question={question}
            settings={settings}
            onExit={() => setScreen('home')}
            onSubmit={(submitted) => {
              setTake(submitted);
              setScreen('analysing');
            }}
          />
        )}
        {screen === 'analysing' && question && take && (
          <Analysing
            question={question}
            settings={settings}
            take={take}
            onBack={() => beginInterview(question)}
            onDone={(finished) => {
              saveResult(finished);
              setResult(finished);
              setTake(null);
              setScreen('results');
            }}
          />
        )}
        {screen === 'results' && result && (
          <Results
            result={result}
            onNext={() => beginInterview(pickQuestion())}
            onRetry={() => beginInterview(result.question)}
            onHome={() => setScreen('home')}
          />
        )}
        {screen === 'history' && (
          <History
            onBack={() => setScreen('home')}
            onView={(saved) => {
              setResult(saved);
              setScreen('results');
            }}
          />
        )}
        {screen === 'settings' && (
          <SettingsPage
            settings={settings}
            onSave={(saved) => {
              setSettings(saved);
              setScreen('home');
            }}
            onBack={() => setScreen('home')}
          />
        )}
      </main>
      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="footer">
      Runs locally on your device. Audio or transcripts are only sent out if you turn on a cloud provider.
    </footer>
  );
}
