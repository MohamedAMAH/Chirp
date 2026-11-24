const keys = new Map<string, { scan: number; x11: number }>();

function row(start: number, codes: string) {
  codes.split(" ").forEach((code, index) => {
    const scan = start + index;
    keys.set(code, { scan, x11: scan + 8 });
  });
}

row(
  1,
  "Escape Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal Backspace",
);
row(
  15,
  "Tab KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight Enter ControlLeft",
);
row(
  30,
  "KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote Backquote ShiftLeft Backslash",
);
row(
  44,
  "KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash ShiftRight NumpadMultiply AltLeft Space CapsLock",
);
row(
  59,
  "F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 NumLock ScrollLock Numpad7 Numpad8 Numpad9 NumpadSubtract Numpad4 Numpad5 Numpad6 NumpadAdd Numpad1 Numpad2 Numpad3 Numpad0 NumpadDecimal",
);
row(86, "IntlBackslash F11 F12");

for (const [code, scan, evdev] of [
  ["NumpadEnter", 0xe01c, 96],
  ["ControlRight", 0xe01d, 97],
  ["NumpadDivide", 0xe035, 98],
  ["PrintScreen", 0xe037, 99],
  ["AltRight", 0xe038, 100],
  ["Home", 0xe047, 102],
  ["ArrowUp", 0xe048, 103],
  ["PageUp", 0xe049, 104],
  ["ArrowLeft", 0xe04b, 105],
  ["ArrowRight", 0xe04d, 106],
  ["End", 0xe04f, 107],
  ["ArrowDown", 0xe050, 108],
  ["PageDown", 0xe051, 109],
  ["Insert", 0xe052, 110],
  ["Delete", 0xe053, 111],
  ["AudioVolumeMute", 0xe020, 113],
  ["AudioVolumeDown", 0xe02e, 114],
  ["AudioVolumeUp", 0xe030, 115],
  ["Pause", 0xe145, 119],
  ["MetaLeft", 0xe05b, 125],
  ["MetaRight", 0xe05c, 126],
  ["ContextMenu", 0xe05d, 127],
  ["IntlRo", 0x73, 89],
  ["IntlYen", 0x7d, 124],
] as const)
  keys.set(code, { scan, x11: evdev + 8 });
for (let number = 13; number <= 24; number++) {
  keys.set(`F${number}`, {
    scan: number === 24 ? 0x76 : 0x64 + number - 13,
    x11: 191 + number - 13,
  });
}

const x11Dictation = /^(Alt|Control|Shift)(Left|Right)$/;
export function physicalKey(code: string) {
  return keys.get(code);
}

export function bindableKeys(windows: boolean) {
  return {
    dictation: [...keys.keys()].filter(
      (code) => windows || x11Dictation.test(code),
    ),
    cancel: [...keys.keys()].filter(
      (code) => windows || !["KeyB", "KeyN", "KeyQ"].includes(code),
    ),
  };
}
