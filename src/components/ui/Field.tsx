import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, hint, children, className = '' }: FieldProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label
        className="font-mono text-[0.65rem] font-medium uppercase tracking-[0.08em] text-meta"
        htmlFor={htmlFor}
      >
        {label}
      </label>
      {children}
      {hint && <div className="text-[0.78rem] text-meta leading-snug">{hint}</div>}
    </div>
  );
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function TextInput({ invalid, className = '', ...rest }: TextInputProps) {
  return (
    <input
      className={`w-full rounded-sm border bg-surface-2 px-3 py-2 font-mono text-[0.88rem] text-ink placeholder:text-hint placeholder:font-sans focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:bg-paper disabled:text-meta ${
        invalid ? 'border-error' : 'border-hairline focus-visible:border-accent'
      } ${className}`}
      {...rest}
    />
  );
}

interface NumberInputProps extends InputHTMLAttributes<HTMLInputElement> {}

export function NumberInput({ className = '', ...rest }: NumberInputProps) {
  return <TextInput type="number" inputMode="numeric" className={className} {...rest} />;
}

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function Checkbox({ label, className = '', id, ...rest }: CheckboxProps) {
  return (
    <label
      htmlFor={id}
      className={`inline-flex cursor-pointer items-center gap-2.5 text-[0.85rem] text-ink ${className}`}
    >
      <input
        id={id}
        type="checkbox"
        className="h-4 w-4 cursor-pointer accent-accent"
        {...rest}
      />
      <span>{label}</span>
    </label>
  );
}

interface ToggleSwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}

export function ToggleSwitch({
  checked,
  label,
  onCheckedChange,
  className = '',
  disabled,
  ...rest
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`inline-flex items-center gap-2 rounded-sm border px-2.5 py-1.5 text-[0.82rem] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${
        checked
          ? 'border-accent bg-accent-soft text-ink'
          : 'border-hairline bg-surface-2 text-meta hover:text-ink'
      } ${className}`}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={`relative h-5 w-9 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-hairline'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
      <span>{label}</span>
    </button>
  );
}
