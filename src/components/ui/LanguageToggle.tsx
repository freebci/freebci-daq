import type { Locale } from '../../i18n';
import { t } from '../../i18n';

interface LanguageToggleProps {
  locale: Locale;
  onToggle: () => void;
}

export function LanguageToggle({ locale, onToggle }: LanguageToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={t(locale, 'language.switchAria')}
      className="inline-flex items-center gap-2 text-[0.85rem] tracking-tight transition-colors hover:text-ink"
    >
      <span
        className={
          locale === 'zh-CN' ? 'font-medium text-ink' : 'text-meta hover:text-ink'
        }
      >
        中文
      </span>
      <span aria-hidden="true" className="text-hairline">
        /
      </span>
      <span
        className={
          locale === 'en-US' ? 'font-medium text-ink' : 'text-meta hover:text-ink'
        }
      >
        EN
      </span>
    </button>
  );
}
