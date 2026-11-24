(() => {
  type DashboardBridge = import("../shared/dashboard").DashboardBridge;
  type DashboardState = import("../shared/dashboard").DashboardState;
  type Preferences = import("../shared/dashboard").Preferences;
  const bridge = (window as unknown as { chirpWindow?: DashboardBridge })
    .chirpWindow;
  const fields = document.querySelectorAll<HTMLInputElement>("[data-setting]");
  const message =
    document.querySelector<HTMLOutputElement>("#settings-message")!;
  let current: DashboardState | undefined;
  let messageTimer: number | undefined;
  function showError(error: string) {
    clearTimeout(messageTimer);
    message.textContent = error;
    message.hidden = false;
    messageTimer = window.setTimeout(() => (message.hidden = true), 4500);
  }
  function setText(id: string, text: string) {
    document.getElementById(id)!.textContent = text;
  }
  function render(state: DashboardState) {
    current = state;
    const { preferences, model, modelOverride } = state;
    setText("live-status", state.status);
    setText("live-model", model === "qwen" ? "Qwen" : "Parakeet");
    setText(
      "live-mode",
      preferences.streaming ? "Streaming" : "Whole recording",
    );
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
    document.querySelector<HTMLInputElement>("#delay")!.disabled =
      !canSubmit || !preferences.autoEnter;
    setText("delay-value", `${preferences.autoEnterDelay} ms`);
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
      showError("Chirp could not save this setting.");
    }
  }
  bridge?.onChange(render);
  void bridge
    ?.read()
    .then(render, () => showError("Chirp could not load its settings."));
  for (const field of fields) {
    field.addEventListener("change", () => {
      if (field.type === "radio" && !field.checked) return;
      const key = field.dataset.setting as keyof Preferences;
      const value =
        field.type === "checkbox"
          ? field.checked
          : field.type === "range"
            ? field.valueAsNumber
            : key === "streaming"
              ? field.value === "true"
              : field.value;
      void save(key, value);
    });
  }
  const delay = document.querySelector<HTMLInputElement>("#delay")!;
  delay.addEventListener("input", () =>
    setText("delay-value", `${delay.value} ms`),
  );

  // The page's security policy blocks inline style attributes, so chart
  // heights and animation delays arrive as data attributes.
  for (const el of document.querySelectorAll<HTMLElement>("[data-h]"))
    el.style.setProperty("--h", `${el.dataset.h}%`);
  for (const el of document.querySelectorAll<HTMLElement>("[data-i]"))
    el.style.setProperty("--i", el.dataset.i ?? "0");

  // Numbers on the Overview count up from zero each time it is shown.
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function countUp() {
    for (const el of document.querySelectorAll<HTMLElement>(".count")) {
      const target = Number(el.dataset.value);
      if (reduceMotion) {
        el.textContent = target.toLocaleString("en-US");
        continue;
      }
      const start = performance.now();
      const tick = (now: number) => {
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

  const live = '[data-setting], input[role="switch"]:not(:disabled)';
  for (const type of ["pointerdown", "mousedown", "click", "keydown"]) {
    document.querySelector("main")?.addEventListener(
      type,
      (event) => {
        const target = event.target as Element;
        if (!target.closest(".card")) return;
        if (event instanceof KeyboardEvent && event.key === "Tab") return;
        if (target.closest(".dropdown")) return;
        const control = target.closest("label")?.control ?? target;
        if (control.matches(live)) return;
        event.preventDefault();
        event.stopPropagation();
      },
      true,
    );
  }

  // A dropdown that matches the app instead of the system menu.
  for (const dropdown of document.querySelectorAll<HTMLElement>(".dropdown")) {
    const button = dropdown.querySelector<HTMLButtonElement>(".dd-button")!;
    const list = dropdown.querySelector<HTMLElement>(".dd-list")!;
    const label = dropdown.querySelector<HTMLElement>(".dd-value")!;
    const options = Array.from(
      list.querySelectorAll<HTMLElement>('[role="option"]'),
    );
    let active = 0;
    const setActive = (index: number) => {
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
      options.forEach((o, n) =>
        o.setAttribute("aria-selected", String(n === index)),
      );
      label.textContent = options[index].textContent?.trim() ?? "";
      close();
      button.focus();
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
    options.forEach((option, index) => {
      option.addEventListener("click", () => choose(index));
      option.addEventListener("mousemove", () => setActive(index));
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

  countUp();

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
