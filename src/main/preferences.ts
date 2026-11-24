import { app } from "electron";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  DashboardState,
  Microphone,
  Preferences,
} from "../shared/dashboard";
import { isSway } from "./sway";
import { DictationActivity } from "./activity";

const validators: {
  [K in keyof Preferences]: (v: unknown) => v is Preferences[K];
} = {
  model: (v): v is Preferences["model"] => v === "qwen" || v === "parakeet",
  streaming: (v): v is boolean => typeof v === "boolean",
  delivery: (v): v is Preferences["delivery"] => v === "paste" || v === "copy",
  autoEnter: (v): v is boolean => typeof v === "boolean",
  clipboardHistory: (v): v is boolean => typeof v === "boolean",
  sounds: (v): v is boolean => typeof v === "boolean",
  microphone: (v): v is string =>
    typeof v === "string" && v.length > 0 && v.length <= 256,
  autoEnterDelay: (v): v is number =>
    typeof v === "number" && v >= 300 && v <= 2000 && v % 50 === 0,
};

function validPreference<K extends keyof Preferences>(
  key: K,
  value: unknown,
): value is Preferences[K] {
  return Object.hasOwn(validators, key) && validators[key](value);
}

export class ChirpState {
  private readonly file = path.join(
    app.getPath("userData"),
    "preferences.json",
  );
  private readonly override = process.env.CHIRP_ASR_MODEL;
  private readonly activity = new DictationActivity(
    path.join(app.getPath("userData"), "activity.json"),
  );
  private readonly listeners = new Set<(key?: keyof Preferences) => void>();
  private readonly preferences: Preferences = {
    model: "qwen",
    streaming: this.override === "parakeet-streaming",
    delivery: "paste",
    autoEnter: false,
    autoEnterDelay: 600,
    clipboardHistory: false,
    microphone: "default",
    sounds: true,
  };
  private status = "Loading";
  private microphones: Microphone[] = [];
  private startup = { enabled: false, available: false };

  constructor() {
    this.refreshStartup();
    try {
      const saved: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      if (!saved || typeof saved !== "object") return;
      for (const key of Object.keys(validators) as (keyof Preferences)[]) {
        this.load(key, (saved as Record<string, unknown>)[key]);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.warn("Could not read Chirp preferences.", error);
    }
  }

  private load<K extends keyof Preferences>(key: K, value: unknown) {
    if (validPreference(key, value)) this.preferences[key] = value;
  }

  get snapshot(): DashboardState {
    const override =
      this.override === "parakeet-streaming" ? "parakeet" : this.override;
    const model = validPreference("model", override) ? override : undefined;
    return {
      preferences: { ...this.preferences },
      model: model ?? this.preferences.model,
      modelOverride: model !== undefined,
      status: this.status,
      canAutoEnter: !isSway(),
      canUseClipboardHistory: process.platform === "win32",
      microphones: this.microphones,
      startup: this.startup,
      activity: this.activity.snapshot,
    };
  }

  set<K extends keyof Preferences>(key: K, value: unknown) {
    if (!validPreference(key, value)) throw new Error("Invalid Chirp setting.");
    if (this.preferences[key] === value) return;
    const next = { ...this.preferences, [key]: value };
    writeFileSync(this.file + ".tmp", JSON.stringify(next, null, 2), "utf8");
    renameSync(this.file + ".tmp", this.file);
    this.preferences[key] = value;
    this.listeners.forEach((listener) => listener(key));
  }

  setStatus(status: string) {
    if (this.status === status) return;
    this.status = status;
    this.listeners.forEach((listener) => listener());
  }

  setMicrophones(devices: Microphone[]) {
    if (JSON.stringify(devices) === JSON.stringify(this.microphones)) return;
    this.microphones = devices;
    this.listeners.forEach((listener) => listener());
  }

  recordDictation(text: string, samples: number) {
    this.activity.record(text, samples);
    this.listeners.forEach((listener) => listener());
  }

  refreshStartup() {
    if (!app.isPackaged || process.platform !== "win32") return;
    const entry = app
      .getLoginItemSettings()
      .launchItems.find(
        (item) => item.name.toLowerCase() === "chirp" && item.scope === "user",
      );
    const available =
      !entry ||
      path.resolve(entry.path).toLowerCase() === process.execPath.toLowerCase();
    const enabled = available && Boolean(entry?.enabled);
    if (
      this.startup.enabled === enabled &&
      this.startup.available === available
    )
      return;
    this.startup = { enabled, available };
    this.listeners.forEach((listener) => listener());
  }

  setStartAtSignIn(enabled: boolean) {
    this.refreshStartup();
    if (!this.startup.available || typeof enabled !== "boolean")
      throw new Error(
        "Start at sign-in is unavailable for this copy of Chirp.",
      );
    app.setLoginItemSettings({
      name: "Chirp",
      path: process.execPath,
      openAtLogin: enabled,
      enabled,
    });
    this.refreshStartup();
    if (this.startup.enabled !== enabled)
      throw new Error("Windows did not save the startup setting.");
  }

  onChange(listener: (key?: keyof Preferences) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
