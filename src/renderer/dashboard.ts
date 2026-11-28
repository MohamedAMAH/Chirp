(() => {
  type DashboardBridge = import("../shared/dashboard").DashboardBridge;
  type DashboardState = import("../shared/dashboard").DashboardState;
  type Preferences = import("../shared/dashboard").Preferences;
  type DictationTotals = import("../shared/dashboard").DictationTotals;
  type RecentTranscript = import("../shared/dashboard").RecentTranscript;
  type Shortcut = "dictationKey" | "cancelKey";
  const bridge = (window as unknown as { chirpWindow?: DashboardBridge })
    .chirpWindow;
  const fields = document.querySelectorAll<HTMLInputElement>("[data-setting]");
  const signIn = document.querySelector<HTMLInputElement>("#signin")!;
  const message =
    document.querySelector<HTMLOutputElement>("#settings-message")!;
  let current: DashboardState | undefined;
  let renderMicrophones: ((state: DashboardState) => void) | undefined;
  let messageTimer: number | undefined;
  function showMessage(text: string) {
    clearTimeout(messageTimer);
    message.textContent = text;
    message.hidden = false;
    messageTimer = window.setTimeout(() => (message.hidden = true), 4500);
  }
  function setText(id: string, text: string) {
    document.getElementById(id)!.textContent = text;
  }
  function render(state: DashboardState) {
    current = state;
    const { preferences, model, modelOverride } = state;
    renderKeys(state);
    signIn.checked = state.startup.enabled;
    signIn.disabled = !state.startup.available;
    setText(
      "signin-hint",
      state.startup.available
        ? "Open Chirp in the tray when you sign in."
        : "Available in the installed Windows app.",
    );
    setText("live-status", state.status);
    setText("live-model", model === "qwen" ? "Qwen" : "Parakeet");
    renderActivity(state.activity);
    renderRecent(state.recent, preferences.keepTranscripts);
    renderMicrophones?.(state);
    setText("live-mode", preferences.streaming ? "Streaming" : "Batch");
    setText(
      "model-hint",
      modelOverride
        ? "Selected by CHIRP_ASR_MODEL."
        : "Changes apply to the next dictation.",
    );
    document.querySelector<HTMLFieldSetElement>("#model-choice")!.disabled =
      modelOverride;
    document.querySelector<HTMLFieldSetElement>("#mode-choice")!.disabled =
      false;
    document.querySelector<HTMLFieldSetElement>("#delivery-choice")!.disabled =
      false;
    const canSubmit = state.canAutoEnter && preferences.delivery === "paste";
    document.querySelector<HTMLInputElement>("#enter")!.disabled = !canSubmit;
    document.querySelector<HTMLInputElement>("#history")!.disabled =
      !state.canUseClipboardHistory;
    setText(
      "history-hint",
      state.canUseClipboardHistory
        ? "Keeps the latest transcript on the clipboard and allows it in Win+V."
        : "Clipboard history is available on Windows.",
    );
    document.querySelector<HTMLInputElement>("#delay")!.disabled =
      !state.canAutoEnter;
    document.querySelector<HTMLInputElement>("#silence-duration")!.disabled =
      !preferences.stopOnSilence;
    setText(
      "live-auto-enter",
      canSubmit ? (preferences.autoEnter ? "On" : "Off") : "Unavailable",
    );
    setText(
      "auto-enter-hint",
      !state.canAutoEnter
        ? "Auto-Enter is unavailable on Sway."
        : preferences.delivery === "copy"
          ? "Choose Paste to use Auto-Enter."
          : "Ctrl+B also toggles Auto-Enter.",
    );
    for (const field of fields) {
      const key = field.dataset.setting as keyof Preferences;
      const value = key === "model" ? model : preferences[key];
      if (field.type === "radio") field.checked = field.value === String(value);
      else if (field.type === "checkbox")
        field.checked = Boolean(value) && (key !== "autoEnter" || canSubmit);
      else field.value = String(value);
    }
  }
  async function save(key: keyof Preferences, value: unknown) {
    try {
      await bridge?.set(key, value);
    } catch {
      if (current) render(current);
      showMessage("Chirp could not save this setting.");
    }
  }
  bridge?.onChange(render);
  signIn.addEventListener("change", async () => {
    try {
      await bridge?.setStartAtSignIn(signIn.checked);
    } catch {
      if (current) render(current);
      showMessage("Chirp could not change the Windows startup setting.");
    }
  });
  void bridge
    ?.read()
    .then(render, () => showMessage("Chirp could not load its settings."));
  for (const field of fields) {
    field.addEventListener("change", () => {
      if (field.type === "radio" && !field.checked) return;
      const key = field.dataset.setting as keyof Preferences;
      const value =
        field.type === "checkbox"
          ? field.checked
          : field.type === "number"
            ? field.valueAsNumber
            : key === "streaming"
              ? field.value === "true"
              : field.value;
      void save(key, value);
    });
  }
  const testMic = document.querySelector<HTMLButtonElement>("#test-mic")!;
  const micBars = Array.from(document.querySelectorAll(".meter i"));
  let testing = false;
  function renderLevel(level: number, active: boolean) {
    testing = active;
    testMic.setAttribute("aria-pressed", String(active));
    testMic.querySelector("kbd")!.textContent = active
      ? "Stop test"
      : "Test mic";
    micBars.forEach((bar, index) =>
      bar.classList.toggle("on", index < Math.round(level * micBars.length)),
    );
  }
  async function testMicrophone(active: boolean) {
    renderLevel(0, active);
    try {
      await bridge?.testMicrophone(active);
    } catch {
      renderLevel(0, false);
      showMessage("Chirp could not test the microphone.");
    }
  }
  testMic.addEventListener("click", () => void testMicrophone(!testing));
  bridge?.onMicrophoneLevel(({ level, testing, error }) => {
    renderLevel(level, testing);
    if (error) showMessage(error);
  });
  window.addEventListener("blur", () => renderLevel(0, false));

  const keyButtons = {
    dictationKey: document.querySelector<HTMLButtonElement>("#dictation-key")!,
    cancelKey: document.querySelector<HTMLButtonElement>("#cancel-key")!,
  };
  let picking: { key: Shortcut; ready: boolean } | undefined;
  function keyName(code: string) {
    const side = code.match(/^(Alt|Control|Meta|Shift)(Left|Right)$/);
    if (side) return `${side[2]} ${side[1] === "Control" ? "Ctrl" : side[1]}`;
    if (code === "Escape") return "Esc";
    return code
      .replace(/^(Key|Digit)(?=.$)/, "")
      .replace(/([a-z])([A-Z0-9])/g, "$1 $2");
  }
  function renderKeys({ preferences, binding }: DashboardState) {
    const managed = binding === "sway";
    setText("live-key", keyName(preferences.dictationKey));
    setText(
      "dictation-key-hint",
      managed
        ? "Sway uses the Right Alt binding in its configuration."
        : binding === "x11"
          ? "Choose a modifier. Hold to talk, or tap to start and stop."
          : "Hold to talk, or tap once to start and again to stop.",
    );
    setText(
      "cancel-key-hint",
      managed
        ? "A dedicated cancel key is unavailable on Sway."
        : "Discards the recording without copying or pasting.",
    );
    for (const key of ["dictationKey", "cancelKey"] as const) {
      const button = keyButtons[key];
      const label =
        picking?.key === key
          ? "Press a key"
          : managed && key === "cancelKey"
            ? "—"
            : keyName(preferences[key]);
      button.disabled = managed;
      button.querySelector("kbd")!.textContent = label;
      button.setAttribute(
        "aria-label",
        `${key === "cancelKey" ? "Cancel key" : "Dictation key"}, ${label}`,
      );
    }
  }
  function stopPicking() {
    if (!picking) return;
    picking = undefined;
    if (current) renderKeys(current);
    void bridge?.captureKey(false).catch(() => {});
  }
  for (const key of ["dictationKey", "cancelKey"] as const) {
    const button = keyButtons[key];
    button.addEventListener("click", async () => {
      if (!current || !bridge) return;
      const wasPicking = picking?.key === key;
      stopPicking();
      if (wasPicking) return;
      const attempt = { key, ready: false };
      picking = attempt;
      renderKeys(current);
      try {
        await bridge.captureKey(true);
        if (picking === attempt) attempt.ready = true;
      } catch {
        if (picking === attempt) stopPicking();
        showMessage("Finish dictating before changing a shortcut.");
      }
    });
    button.addEventListener("blur", () => {
      if (picking?.key === key) stopPicking();
    });
    button.addEventListener("keydown", async (event) => {
      if (!current || picking?.key !== key) return;
      event.preventDefault();
      if (!picking.ready || event.repeat) return;
      const choice = event.code;
      const other = key === "cancelKey" ? "dictationKey" : "cancelKey";
      const options =
        key === "cancelKey"
          ? current.bindableKeys.cancel
          : current.bindableKeys.dictation;
      if (!options.includes(choice) || current.preferences[other] === choice) {
        showMessage("Choose a different key for this shortcut.");
        return;
      }
      const attempt = picking;
      attempt.ready = false;
      await save(key, choice);
      if (picking === attempt) stopPicking();
    });
  }
  window.addEventListener("blur", stopPicking);

  const recentList = document.querySelector<HTMLUListElement>(
    "#recent-transcripts",
  )!;
  const emptyList = document.querySelector<HTMLElement>("#transcript-empty")!;
  const transcriptTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
  let lastRecent = "";
  function renderRecent(recent: RecentTranscript[], keeping: boolean) {
    const signature = `${keeping}:${recent.map(({ id }) => id).join(",")}`;
    if (lastRecent === signature) return;
    lastRecent = signature;
    emptyList.hidden = recent.length > 0;
    recentList.hidden = !recent.length;
    emptyList.textContent = keeping
      ? "Your recent dictations appear here."
      : "Recent transcripts are off.";
    recentList.replaceChildren(
      ...recent.map((transcript) => {
        const row = document.createElement("li");
        row.className = "row";
        const details = document.createElement("div");
        details.className = "text";
        details.textContent = transcript.text;
        const time = document.createElement("time");
        time.className = "hint";
        time.dateTime = new Date(transcript.recordedAt).toISOString();
        time.textContent = transcriptTime.format(transcript.recordedAt);
        details.append(time);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "key";
        const label = document.createElement("kbd");
        label.textContent = "Copy";
        button.append(label);
        button.addEventListener("click", async () => {
          try {
            await bridge?.copyTranscript(transcript.id);
            showMessage("Transcript copied.");
          } catch {
            showMessage("Chirp could not copy this transcript.");
          }
        });
        row.append(details, button);
        return row;
      }),
    );
  }

  const counts = document.querySelectorAll<HTMLElement>(".count");
  const allTimeCounts = document.querySelectorAll<HTMLElement>(".tile-total");
  const bars = document.querySelector<HTMLElement>(".bars")!;
  const columns = document.querySelectorAll<HTMLElement>(".col");
  const format = new Intl.NumberFormat();
  let lastActivity = "";
  function activityValues({ words, dictations, seconds }: DictationTotals) {
    return [
      words,
      dictations,
      Math.round(seconds / 60),
      Math.max(0, Math.round(words / 40 - seconds / 60)),
    ];
  }
  function renderActivity(activity: DashboardState["activity"]) {
    const data = JSON.stringify(activity);
    if (lastActivity === data) return;
    const animate = lastActivity === "";
    lastActivity = data;
    activityValues(activity.thisWeek).forEach((value, index) => {
      counts[index].dataset.value = String(value);
      counts[index].textContent = format.format(value);
    });
    activityValues(activity.allTime).forEach((value, index) => {
      allTimeCounts[index].textContent =
        `${format.format(value)}${index > 1 ? " min" : ""} all time`;
    });
    const max = Math.max(...activity.dailyWords);
    const dailySummary: string[] = [];
    columns.forEach((column, day) => {
      const words = activity.dailyWords[day];
      column.style.setProperty("--h", `${max ? (words / max) * 100 : 0}%`);
      column.classList.toggle("peak", words > 0 && words === max);
      column.querySelector(".val")!.textContent = format.format(words);
      dailySummary.push(
        `${column.querySelector(".day")!.textContent} ${format.format(words)}`,
      );
    });
    bars.setAttribute(
      "aria-label",
      `Words dictated this week. ${dailySummary.join(", ")}.`,
    );
    countAnimation++;
    if (
      animate &&
      !document.querySelector<HTMLElement>("#panel-overview")!.hidden
    )
      countUp();
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-i]"))
    el.style.setProperty("--i", el.dataset.i ?? "0");

  // Numbers on the Overview count up from zero each time it is shown.
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let countAnimation = 0;
  function countUp() {
    const animation = ++countAnimation;
    for (const el of document.querySelectorAll<HTMLElement>(".count")) {
      const target = Number(el.dataset.value);
      if (reduceMotion) {
        el.textContent = target.toLocaleString("en-US");
        continue;
      }
      const start = performance.now();
      const tick = (now: number) => {
        if (animation !== countAnimation) return;
        const t = Math.min(1, (now - start) / 1000);
        const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
        el.textContent = Math.round(target * eased).toLocaleString("en-US");
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  const tabs = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  );
  function select(tab: HTMLButtonElement, focus = false) {
    if (testing && tab.id !== "tab-dictation") void testMicrophone(false);
    if (
      tab.id === "tab-overview" &&
      tab.getAttribute("aria-selected") !== "true"
    )
      countUp();
    for (const other of tabs) {
      const on = other === tab;
      other.setAttribute("aria-selected", String(on));
      other.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(
        other.getAttribute("aria-controls") ?? "",
      );
      if (panel) panel.hidden = !on;
    }
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const step =
        event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (step) {
        event.preventDefault();
        select(tabs[(index + step + tabs.length) % tabs.length], true);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        select(event.key === "Home" ? tabs[0] : tabs[tabs.length - 1], true);
      }
    });
  });

  // A dropdown that matches the app instead of the system menu.
  for (const dropdown of document.querySelectorAll<HTMLElement>(".dropdown")) {
    const button = dropdown.querySelector<HTMLButtonElement>(".dd-button")!;
    const list = dropdown.querySelector<HTMLElement>(".dd-list")!;
    const label = dropdown.querySelector<HTMLElement>(".dd-value")!;
    let options: HTMLElement[] = [];
    let deviceList = "";
    let active = 0;
    const setActive = (index: number) => {
      if (!options.length) return;
      active = (index + options.length) % options.length;
      options.forEach((o, n) => o.classList.toggle("active", n === active));
      list.setAttribute("aria-activedescendant", options[active].id);
      options[active].scrollIntoView({ block: "nearest" });
    };
    const close = () => {
      list.hidden = true;
      button.setAttribute("aria-expanded", "false");
    };
    const open = () => {
      dropdown.classList.remove("up");
      list.hidden = false;
      const room = window.innerHeight - button.getBoundingClientRect().bottom;
      dropdown.classList.toggle("up", room < list.offsetHeight + 16);
      button.setAttribute("aria-expanded", "true");
      setActive(
        options.findIndex((o) => o.getAttribute("aria-selected") === "true"),
      );
    };
    const choose = (index: number) => {
      if (options[index])
        void save("microphone", options[index].dataset.device);
      close();
      button.focus();
    };
    renderMicrophones = ({ microphones, preferences }) => {
      const devices = [
        { id: "default", label: "System default" },
        ...microphones,
      ];
      const signature = JSON.stringify(devices);
      if (deviceList !== signature) {
        close();
        deviceList = signature;
        options = devices.map((device, index) => {
          const option = document.createElement("li");
          option.id = `microphone-option-${index}`;
          option.setAttribute("role", "option");
          option.dataset.device = device.id;
          option.textContent = device.label;
          return option;
        });
        list.replaceChildren(...options);
      }
      const selected = devices.find(
        (device) => device.id === preferences.microphone,
      );
      options.forEach((option) =>
        option.setAttribute(
          "aria-selected",
          String(option.dataset.device === (selected?.id ?? "default")),
        ),
      );
      label.textContent =
        selected?.label ?? "System default (saved mic unavailable)";
      setText("live-microphone", label.textContent);
      button.disabled = false;
    };
    button.addEventListener("click", () => (list.hidden ? open() : close()));
    button.addEventListener("keydown", (event) => {
      if (list.hidden) {
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
          event.preventDefault();
          open();
        }
        return;
      }
      const moves: Record<string, () => void> = {
        ArrowDown: () => setActive(active + 1),
        ArrowUp: () => setActive(active - 1),
        Home: () => setActive(0),
        End: () => setActive(options.length - 1),
        Enter: () => choose(active),
        " ": () => choose(active),
        Escape: close,
        Tab: close,
      };
      const move = moves[event.key];
      if (!move) return;
      if (event.key !== "Tab") event.preventDefault();
      move();
    });
    list.addEventListener("click", (event) => {
      const option = (event.target as Element).closest<HTMLElement>(
        '[role="option"]',
      );
      if (option) choose(options.indexOf(option));
    });
    list.addEventListener("mousemove", (event) => {
      const option = (event.target as Element).closest<HTMLElement>(
        '[role="option"]',
      );
      if (option) setActive(options.indexOf(option));
    });
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!dropdown.contains(event.target as Node)) close();
      },
      true,
    );
    for (const tab of tabs) tab.addEventListener("click", close);
  }

  const maximize = document.getElementById("maximize");
  document
    .getElementById("minimize")
    ?.addEventListener("click", () => bridge?.minimize());
  maximize?.addEventListener("click", () => bridge?.toggleMaximize());
  document
    .getElementById("close")
    ?.addEventListener("click", () => bridge?.close());
  bridge?.onMaximizedChange((maximized) => {
    document.documentElement.dataset.maximized = String(maximized);
    maximize?.setAttribute("aria-label", maximized ? "Restore" : "Maximize");
  });
})();
