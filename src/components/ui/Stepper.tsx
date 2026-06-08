interface Step {
  label: string;
  hint?: string;
}

interface StepperProps {
  steps: Step[];
  currentIndex: number;
  ariaLabel?: string;
}

export function Stepper({ steps, currentIndex, ariaLabel }: StepperProps) {
  return (
    <nav aria-label={ariaLabel} className="w-full">
      <ol className="flex w-full items-start gap-0 m-0 p-0 list-none">
        {steps.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const stepNumber = String(index + 1).padStart(2, '0');

          return (
            <li
              key={step.label}
              className="flex items-start gap-4 flex-1 min-w-0"
            >
              <div className="flex flex-col gap-2 min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border text-[0.65rem] font-mono font-medium tabular transition-colors ${
                      isCompleted
                        ? 'border-accent bg-accent text-paper'
                        : isCurrent
                          ? 'border-accent text-accent bg-card'
                          : 'border-hairline text-hint bg-card'
                    }`}
                    aria-hidden="true"
                  >
                    {stepNumber}
                  </span>
                  {index < steps.length - 1 && (
                    <span
                      className={`h-px flex-1 ${isCompleted ? 'bg-accent' : 'bg-hairline'}`}
                      aria-hidden="true"
                    />
                  )}
                </div>
                <div className="flex flex-col gap-0.5 pr-4">
                  <span
                    className={`text-[0.92rem] font-medium leading-tight ${
                      isCompleted || isCurrent ? 'text-ink' : 'text-hint'
                    }`}
                  >
                    {step.label}
                  </span>
                  {step.hint && (
                    <span className="text-[0.78rem] text-meta leading-snug">
                      {step.hint}
                    </span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
