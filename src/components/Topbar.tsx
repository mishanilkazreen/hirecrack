interface Props {
  page: string;
  onHome: () => void;
  onHistory: () => void;
  onSettings: () => void;
  /** Hide the icon buttons (used during onboarding). */
  bare?: boolean;
}

export default function Topbar({ page, onHome, onHistory, onSettings, bare }: Props) {
  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={bare ? undefined : onHome}>
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" width={24} height={24} />
        HireCrack
      </button>
      {!bare && (
        <nav className="topbar-actions">
          <button
            type="button"
            className={`icon-btn${page === 'history' ? ' icon-btn-active' : ''}`}
            aria-label="History"
            title="History"
            aria-current={page === 'history' ? 'page' : undefined}
            onClick={onHistory}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
              <path d="M12 7v5l3 2" />
            </svg>
          </button>
          <button
            type="button"
            className={`icon-btn${page === 'settings' ? ' icon-btn-active' : ''}`}
            aria-label="Settings"
            title="Settings"
            aria-current={page === 'settings' ? 'page' : undefined}
            onClick={onSettings}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </button>
        </nav>
      )}
    </header>
  );
}
