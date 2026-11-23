#include <X11/XKBlib.h>
#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/extensions/XInput2.h>
#include <X11/extensions/XTest.h>
#include <X11/keysym.h>
#include <poll.h>
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <cctype>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>

namespace {
using Clock = std::chrono::steady_clock;
using namespace std::chrono_literals;

int xError;
int rememberError(Display*, XErrorEvent* event) {
    xError = event->error_code;
    return 0;
}

void emit(const std::string& message) {
    std::cout << message << std::endl;
}

std::string fromHex(const std::string& hex) {
    if (hex.size() % 2) return {};
    std::string output;
    output.reserve(hex.size() / 2);
    for (size_t i = 0; i < hex.size(); i += 2) {
        if (!std::isxdigit(static_cast<unsigned char>(hex[i])) ||
            !std::isxdigit(static_cast<unsigned char>(hex[i + 1]))) return {};
        output.push_back(static_cast<char>(std::stoi(hex.substr(i, 2), nullptr, 16)));
    }
    return output;
}

class Input {
    Display* display;
    Window root, owner, destination = None;
    Atom clipboard, utf8, targets, textPlain;
    KeyCode rightAlt, toggleEnter, toggleMode;
    int xiOpcode = 0;
    unsigned session = 0, lockMask = LockMask;
    bool armed = false, held = false, chord = false, focusChanged = false;
    bool autoEnter = false, submit = false, enterPending = false;
    bool enterKeyHeld = false, modeKeyHeld = false;
    std::string text;
    Clock::time_point pasteDeadline{}, enterDeadline{};

    KeyCode code(KeySym symbol) const { return XKeysymToKeycode(display, symbol); }

    Window focus() const {
        Window window;
        int revert;
        XGetInputFocus(display, &window, &revert);
        return window == PointerRoot ? None : window;
    }

    bool belongsTo(Window window, Window ancestor) const {
        while (window && window != root) {
            if (window == ancestor) return true;
            Window treeRoot, parent, *children = nullptr;
            unsigned count;
            if (!XQueryTree(display, window, &treeRoot, &parent, &children, &count)) break;
            if (children) XFree(children);
            window = parent;
        }
        return false;
    }

    bool isTerminal() const {
        Window window = destination;
        while (window && window != root) {
            XClassHint hint{};
            if (XGetClassHint(display, window, &hint)) {
                std::string name = hint.res_class ? hint.res_class : "";
                if (hint.res_name) XFree(hint.res_name);
                if (hint.res_class) XFree(hint.res_class);
                std::transform(name.begin(), name.end(), name.begin(),
                               [](unsigned char c) { return std::tolower(c); });
                return name.find("terminal") != std::string::npos ||
                    name.find("xterm") != std::string::npos ||
                    name == "konsole" || name == "kitty" || name == "alacritty" ||
                    name.find("wezterm") != std::string::npos;
            }
            Window treeRoot, parent, *children = nullptr;
            unsigned count;
            if (!XQueryTree(display, window, &treeRoot, &parent, &children, &count)) return false;
            if (children) XFree(children);
            window = parent;
        }
        return false;
    }

    void nearPointer(const std::string& message) const {
        Window queryRoot, child;
        int x = 0, y = 0, childX, childY;
        unsigned modifiers;
        XQueryPointer(display, root, &queryRoot, &child, &x, &y,
                      &childX, &childY, &modifiers);
        emit(message + " " + std::to_string(x) + " " + std::to_string(y));
    }

    bool canSend() const {
        Window queryRoot, child;
        int x, y, childX, childY;
        unsigned mask = 0;
        return !focusChanged && destination && focus() == destination &&
            XGetSelectionOwner(display, clipboard) == owner &&
            XQueryPointer(display, root, &queryRoot, &child, &x, &y, &childX, &childY, &mask) &&
            !(mask & (ControlMask | ShiftMask | Mod1Mask | Mod3Mask | Mod4Mask | Mod5Mask));
    }

    void fake(KeySym symbol, bool press) const {
        XTestFakeKeyEvent(display, code(symbol), press, CurrentTime);
    }

    void selection(const XSelectionRequestEvent& request) {
        XEvent reply{};
        auto& event = reply.xselection;
        event.type = SelectionNotify;
        event.requestor = request.requestor;
        event.selection = request.selection;
        event.target = request.target;
        event.time = request.time;
        const Atom property = request.property ? request.property : request.target;
        const bool wantsText = request.target == utf8 || request.target == textPlain;
        if (request.selection == clipboard && request.target == targets) {
            const Atom supported[]{targets, utf8, textPlain};
            XChangeProperty(display, request.requestor, property, XA_ATOM, 32, PropModeReplace,
                            reinterpret_cast<const unsigned char*>(supported), 3);
            event.property = property;
        } else if (request.selection == clipboard && wantsText && !text.empty()) {
            XChangeProperty(display, request.requestor, property, request.target, 8, PropModeReplace,
                            reinterpret_cast<const unsigned char*>(text.data()), text.size());
            event.property = property;
        }
        XSendEvent(display, request.requestor, False, 0, &reply);
        XFlush(display);
        if (wantsText && event.property && pasteDeadline != Clock::time_point{} &&
            (belongsTo(request.requestor, destination) || belongsTo(destination, request.requestor)) &&
            canSend()) {
            pasteDeadline = {};
            if (submit && autoEnter) {
                enterPending = true;
                enterDeadline = Clock::now() + 700ms;
            } else emit("pasted");
        }
    }

    void rawKey(const XIRawEvent& event) {
        if (event.flags & XIKeyRepeat) return;
        const bool down = event.evtype == XI_RawKeyPress;
        if (down && enterPending) submit = false;
        if (event.detail == rightAlt) {
            if (down && !held && armed) {
                held = true;
                armed = chord = focusChanged = false;
                submit = autoEnter;
                if (destination) XSelectInput(display, destination, NoEventMask);
                destination = focus();
                if (destination) XSelectInput(display, destination, FocusChangeMask);
                nearPointer("down " + std::to_string(++session));
            } else if (!down && held) {
                held = false;
                if (!chord) emit("up " + std::to_string(session));
            }
        } else if (down && held && !chord) {
            chord = true;
            emit("cancel " + std::to_string(session));
        }
    }

    void event(XEvent& event) {
        if (event.type == GenericEvent && event.xcookie.extension == xiOpcode &&
            XGetEventData(display, &event.xcookie)) {
            if (event.xcookie.evtype == XI_RawKeyPress || event.xcookie.evtype == XI_RawKeyRelease)
                rawKey(*static_cast<XIRawEvent*>(event.xcookie.data));
            XFreeEventData(display, &event.xcookie);
        } else if (event.type == FocusOut && event.xfocus.window == destination &&
                   event.xfocus.mode == NotifyNormal) {
            focusChanged = true;
        } else if (event.type == KeyRelease && event.xkey.keycode == toggleEnter) {
            enterKeyHeld = false;
        } else if (event.type == KeyRelease && event.xkey.keycode == toggleMode) {
            modeKeyHeld = false;
        } else if (event.type == KeyPress && event.xkey.keycode == toggleEnter && !enterKeyHeld) {
            enterKeyHeld = true;
            autoEnter = !autoEnter;
            if (!autoEnter) submit = false;
            nearPointer(autoEnter ? "auto-enter on" : "auto-enter off");
        } else if (event.type == KeyPress && event.xkey.keycode == toggleMode && !modeKeyHeld) {
            modeKeyHeld = true;
            nearPointer("toggle-mode");
        } else if (event.type == SelectionRequest) {
            selection(event.xselectionrequest);
        } else if (event.type == SelectionClear) {
            text.clear();
            if (pasteDeadline != Clock::time_point{}) {
                pasteDeadline = {};
                emit("clipboard-changed");
            }
        }
    }

    void grab(KeyCode key, const char* name) {
        XSync(display, False);
        xError = 0;
        for (unsigned locks = lockMask;; locks = (locks - 1) & lockMask) {
            XGrabKey(display, key, ControlMask | locks, root, False, GrabModeAsync, GrabModeAsync);
            if (!locks) break;
        }
        XSync(display, False);
        if (xError) nearPointer(std::string("shortcut-unavailable ") + name);
    }

    void paste(unsigned id, const std::string& hex) {
        auto transcript = fromHex(hex);
        if (id != session || held || transcript.empty() ||
            transcript.size() > static_cast<size_t>(XMaxRequestSize(display)) * 4 - 128) {
            emit("paste-error");
            return;
        }
        text = std::move(transcript);
        XSetSelectionOwner(display, clipboard, owner, CurrentTime);
        if (XGetSelectionOwner(display, clipboard) != owner) {
            emit("paste-error");
            return;
        }
        const bool terminal = isTerminal();
        if (!canSend() || (terminal && text.find_first_of("\r\n") != std::string::npos)) {
            emit("copied");
            return;
        }
        fake(XK_Control_L, true);
        if (terminal) fake(XK_Shift_L, true);
        fake(XK_v, true);
        fake(XK_v, false);
        if (terminal) fake(XK_Shift_L, false);
        fake(XK_Control_L, false);
        XFlush(display);
        pasteDeadline = Clock::now() + 1500ms;
    }

public:
    explicit Input(Display* x) : display(x), root(DefaultRootWindow(x)),
        owner(XCreateSimpleWindow(x, root, 0, 0, 1, 1, 0, 0, 0)),
        clipboard(XInternAtom(x, "CLIPBOARD", False)),
        utf8(XInternAtom(x, "UTF8_STRING", False)),
        targets(XInternAtom(x, "TARGETS", False)),
        textPlain(XInternAtom(x, "text/plain;charset=utf-8", False)),
        rightAlt(code(XK_Alt_R)), toggleEnter(code(XK_b)), toggleMode(code(XK_n)) {}

    bool connect() {
        int eventBase, errorBase, major = 2, minor = 1, event, error;
        if (!XQueryExtension(display, "XInputExtension", &xiOpcode, &eventBase, &errorBase) ||
            XIQueryVersion(display, &major, &minor) != Success ||
            !XTestQueryExtension(display, &event, &error, &major, &minor)) return false;
        if (auto* map = XkbGetKeyboard(display, XkbAllComponentsMask, XkbUseCoreKbd)) {
            if (map->names && map->names->keys)
                for (int key = map->min_key_code; key <= map->max_key_code; ++key)
                    if (std::memcmp(map->names->keys[key].name, "RALT", 4) == 0)
                        rightAlt = key;
            XkbFreeKeyboard(map, XkbAllComponentsMask, True);
        }
        if (!rightAlt) return false;
        XkbSetDetectableAutoRepeat(display, True, nullptr);
        unsigned char mask[XIMaskLen(XI_RawKeyRelease)]{};
        XISetMask(mask, XI_RawKeyPress);
        XISetMask(mask, XI_RawKeyRelease);
        XIEventMask events{XIAllMasterDevices, sizeof(mask), mask};
        XISelectEvents(display, root, &events, 1);
        if (auto* modifiers = XGetModifierMapping(display)) {
            for (int i = 0; i < 8 * modifiers->max_keypermod; ++i)
                if (modifiers->modifiermap[i] && modifiers->modifiermap[i] == code(XK_Num_Lock))
                    lockMask |= 1U << (i / modifiers->max_keypermod);
            XFreeModifiermap(modifiers);
        }
        emit("connected");
        grab(toggleEnter, "Ctrl+B");
        grab(toggleMode, "Ctrl+N");
        return true;
    }

    void run() {
        std::string pending;
        pollfd files[]{{ConnectionNumber(display), POLLIN, 0}, {STDIN_FILENO, POLLIN, 0}};
        for (;;) {
            while (XPending(display)) {
                XEvent next;
                XNextEvent(display, &next);
                event(next);
            }
            if (pasteDeadline != Clock::time_point{} && Clock::now() >= pasteDeadline) {
                pasteDeadline = {};
                emit("copied");
            }
            if (enterPending && Clock::now() >= enterDeadline) {
                enterPending = false;
                if (submit && autoEnter && canSend()) {
                    fake(XK_Return, true);
                    fake(XK_Return, false);
                    XFlush(display);
                    emit("pasted");
                } else emit("enter-skipped");
            }
            const bool waiting = pasteDeadline != Clock::time_point{} || enterPending;
            if (poll(files, 2, waiting ? 20 : -1) < 0) return;
            if (files[0].revents & (POLLERR | POLLHUP | POLLNVAL)) return;
            if (!files[1].revents) continue;
            char buffer[4096];
            const auto count = read(STDIN_FILENO, buffer, sizeof(buffer));
            if (count <= 0) return;
            pending.append(buffer, count);
            size_t newline;
            while ((newline = pending.find('\n')) != std::string::npos) {
                std::istringstream line(pending.substr(0, newline));
                pending.erase(0, newline + 1);
                std::string command;
                line >> command;
                if (command == "quit") return;
                if (command == "arm") armed = true;
                if (command == "paste") {
                    unsigned id;
                    std::string hex;
                    if (line >> id >> hex) paste(id, hex);
                    else emit("paste-error");
                }
            }
        }
    }
};
}

int main() {
    XSetErrorHandler(rememberError);
    Display* display = XOpenDisplay(nullptr);
    if (!display) return 1;
    Input input(display);
    const bool connected = input.connect();
    if (connected) input.run();
    XCloseDisplay(display);
    return connected ? 0 : 1;
}
