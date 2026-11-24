export interface Preferences {
  model: "qwen" | "parakeet";
  streaming: boolean;
  delivery: "paste" | "copy";
  autoEnter: boolean;
  autoEnterDelay: number;
  clipboardHistory: boolean;
  microphone: string;
  sounds: boolean;
}

export interface Microphone {
  id: string;
  label: string;
}

export interface MicrophoneLevel {
  level: number;
  testing: boolean;
  error?: string;
}

export interface DashboardState {
  preferences: Preferences;
  model: Preferences["model"];
  modelOverride: boolean;
  status: string;
  canAutoEnter: boolean;
  canUseClipboardHistory: boolean;
  microphones: Microphone[];
  startup: { enabled: boolean; available: boolean };
}

export interface DashboardBridge {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  onMaximizedChange(listener: (maximized: boolean) => void): void;
  read(): Promise<DashboardState>;
  onChange(listener: (state: DashboardState) => void): void;
  set(key: keyof Preferences, value: unknown): Promise<void>;
  testMicrophone(enabled: boolean): Promise<void>;
  onMicrophoneLevel(listener: (level: MicrophoneLevel) => void): void;
  setStartAtSignIn(enabled: boolean): Promise<void>;
}
