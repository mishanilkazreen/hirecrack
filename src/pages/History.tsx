import { useState } from 'react';
import BackButton from '../components/BackButton';
import { clearHistory, loadHistory } from '../lib/history';
import type { AttemptResult } from '../types';

interface Props {
  onView: (result: AttemptResult) => void;
  onBack: () => void;
}

export default function History({ onView, onBack }: Props) {
  const [results, setResults] = useState<AttemptResult[]>(() => loadHistory());

  const clear = () => {
    if (window.confirm('Delete all saved practice history from this device?')) {
      clearHistory();
      setResults([]);
    }
  };

  return (
    <section className="page narrow">
      <div className="page-head">
        <div className="page-head-main">
          <BackButton onClick={onBack} />
          <h2>History</h2>
        </div>
        {results.length > 0 && (
          <button type="button" className="btn btn-sm btn-danger-outline" onClick={clear}>
            Clear history
          </button>
        )}
      </div>
      {results.length === 0 ? (
        <p className="muted">No answers yet.</p>
      ) : (
        <ul className="history-list">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" className="history-item" onClick={() => onView(r)}>
                <span className="history-score">{Math.round(r.evaluation.score)}</span>
                <span className="history-body">
                  <span className="history-q">{r.question.text}</span>
                  <span className="small muted">
                    {new Date(r.createdAt).toLocaleString()} · {r.evaluation.verdict}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
