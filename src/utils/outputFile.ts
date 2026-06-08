export interface EegOutputFileStream {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

export interface EegOutputFileTarget {
  name: string;
  open(): Promise<EegOutputFileStream>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}

interface SaveFileHandle {
  readonly name: string;
  createWritable(options?: { keepExistingData?: boolean }): Promise<EegOutputFileStream>;
}

type SaveFilePickerWindow = Window &
  typeof globalThis & {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<SaveFileHandle>;
  };

export function isOutputFilePickerSupported(): boolean {
  return typeof window !== 'undefined' && typeof getSaveFilePicker() === 'function';
}

export async function chooseEegOutputFile(): Promise<EegOutputFileTarget> {
  const showSaveFilePicker = getSaveFilePicker();

  if (!showSaveFilePicker) {
    throw new Error('File picker is not supported in this browser.');
  }

  const handle = await showSaveFilePicker({
    suggestedName: `eeg-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
    types: [
      {
        description: 'EEG CSV',
        accept: {
          'text/csv': ['.csv'],
        },
      },
    ],
  });

  return {
    name: handle.name,
    open: () => handle.createWritable({ keepExistingData: false }),
  };
}

function getSaveFilePicker(): SaveFilePickerWindow['showSaveFilePicker'] {
  return (window as SaveFilePickerWindow).showSaveFilePicker;
}
