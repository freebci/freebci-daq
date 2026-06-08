import { useEffect, useState, type ReactNode } from 'react';
import type { Locale, TranslationKey } from '../i18n';
import { t } from '../i18n';
import { useAiStore } from '../store/aiStore';
import { useEegStore } from '../store/eegStore';
import { StatusDot } from './ui';

export type WorkspacePage = 'setup' | 'live' | 'analysis' | 'sessions' | 'system';

type StatusTone = 'idle' | 'active' | 'success' | 'warn' | 'error';

interface WorkspaceShellProps {
  locale: Locale;
  statusTone: StatusTone;
  modeBadge: string;
  children: (activePage: WorkspacePage) => ReactNode;
}

const WORKSPACE_PAGE_STORAGE_KEY = 'eeg-workspace-active-page';

const WORKSPACE_PAGES: readonly WorkspacePage[] = [
  'setup',
  'live',
  'analysis',
  'sessions',
  'system',
];

const PAGE_LABEL_KEYS: Record<WorkspacePage, TranslationKey> = {
  setup: 'page.setup',
  live: 'page.live',
  analysis: 'page.analysis',
  sessions: 'page.sessions',
  system: 'page.system',
};

const PAGE_HINT_KEYS: Record<WorkspacePage, TranslationKey> = {
  setup: 'page.setupHint',
  live: 'page.liveHint',
  analysis: 'page.analysisHint',
  sessions: 'page.sessionsHint',
  system: 'page.systemHint',
};

function isWorkspacePage(value: string | null): value is WorkspacePage {
  return Boolean(value && (WORKSPACE_PAGES as readonly string[]).includes(value));
}

function readStoredPage(): WorkspacePage {
  if (typeof window === 'undefined') return 'setup';
  const stored = window.localStorage.getItem(WORKSPACE_PAGE_STORAGE_KEY);
  return isWorkspacePage(stored) ? stored : 'setup';
}

export function WorkspaceShell({
  locale,
  statusTone,
  modeBadge,
  children,
}: WorkspaceShellProps) {
  const [activePage, setActivePage] = useState<WorkspacePage>(() => readStoredPage());
  const stream = useEegStore((state) => state.stream);
  const frameCount = useAiStore((state) => state.frameCount);
  const pendingWriteCount = useAiStore((state) => state.pendingWriteCount);
  const writeTimeoutCount = useAiStore((state) => state.writeTimeoutCount);
  const conversationId = useAiStore((state) => state.conversationId);

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_PAGE_STORAGE_KEY, activePage);
  }, [activePage]);

  return (
    <main className="mx-auto grid max-w-[88rem] grid-cols-1 gap-4 px-4 pt-4 pb-16 lg:grid-cols-[15rem_minmax(0,1fr)] lg:px-5 lg:pt-6">
      <aside className="min-w-0 lg:sticky lg:top-14 lg:self-start">
        <div className="rounded-sm border border-hairline bg-card">
          <nav
            role="tablist"
            aria-label={t(locale, 'page.navAria')}
            className="flex gap-2 overflow-x-auto border-b border-hairline p-2 lg:flex-col lg:overflow-visible"
          >
            {WORKSPACE_PAGES.map((page) => {
              const isActive = activePage === page;
              return (
                <button
                  key={page}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActivePage(page)}
                  className={`min-w-32 rounded-sm border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:min-w-0 ${
                    isActive
                      ? 'border-accent bg-accent text-white'
                      : 'border-transparent bg-transparent text-meta hover:bg-surface-2 hover:text-ink'
                  }`}
                >
                  <span className="block text-[0.82rem] font-medium">
                    {t(locale, PAGE_LABEL_KEYS[page])}
                  </span>
                  <span
                    className={`block pt-0.5 text-[0.68rem] leading-snug ${
                      isActive ? 'text-white/80' : 'text-hint'
                    }`}
                  >
                    {t(locale, PAGE_HINT_KEYS[page])}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="grid grid-cols-2 gap-0 border-b border-hairline lg:grid-cols-1">
            <div className="border-r border-hairline p-3 lg:border-r-0 lg:border-b">
              <p className="m-0 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-meta">
                {t(locale, 'workspace.acquisitionState')}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <StatusDot tone={statusTone} pulse={statusTone === 'active'} />
                <span className="font-mono text-[0.74rem] text-ink">{modeBadge}</span>
              </div>
            </div>
            <div className="p-3 lg:border-b">
              <p className="m-0 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-meta">
                {t(locale, 'workspace.streamState')}
              </p>
              <p className="m-0 pt-1 font-mono text-[0.74rem] text-ink">
                {stream.isStreaming ? t(locale, 'workspace.streaming') : t(locale, 'workspace.idle')}
              </p>
            </div>
            <div className="border-r border-t border-hairline p-3 lg:border-r-0 lg:border-t-0 lg:border-b">
              <p className="m-0 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-meta">
                {t(locale, 'workspace.aiFrames')}
              </p>
              <p className="m-0 pt-1 font-mono text-[0.74rem] text-ink">
                {frameCount} / {pendingWriteCount} / {writeTimeoutCount}
              </p>
            </div>
            <div className="border-t border-hairline p-3 lg:border-t-0">
              <p className="m-0 font-mono text-[0.62rem] uppercase tracking-[0.08em] text-meta">
                {t(locale, 'workspace.conversation')}
              </p>
              <p className="m-0 break-all pt-1 font-mono text-[0.74rem] text-ink">
                {conversationId.slice(0, 8)}
              </p>
            </div>
          </div>
        </div>
      </aside>

      <section className="min-w-0" role="tabpanel">
        <div className="flex flex-col gap-4">{children(activePage)}</div>
      </section>
    </main>
  );
}
