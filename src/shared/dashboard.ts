export interface Preferences {
  model: "qwen" | "parakeet";
  streaming: boolean;
  delivery: "paste" | "copy";
  autoEnter: boolean;
  autoEnterDelay: number;
}

export interface DashboardState {
  preferences: Preferences;
  model: Preferences["model"];
  modelOverride: boolean;
  status: string;
  canAutoEnter: boolean;
}

export interface DashboardBridge {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  onMaximizedChange(listener: (maximized: boolean) => void): void;
  read(): Promise<DashboardState>;
  onChange(listener: (state: DashboardState) => void): void;
  set(key: keyof Preferences, value: unknown): Promise<void>;
}
