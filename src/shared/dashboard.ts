export interface Preferences {
  model: "qwen" | "parakeet";
  streaming: boolean;
}

export interface DashboardState {
  preferences: Preferences;
  model: Preferences["model"];
  modelOverride: boolean;
  status: string;
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
