#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <thread>
#include "clipboard.hpp"

namespace {
HWND owner, destination;
DWORD destinationPid;
bool armed, held, chord, forwardAlt, focusChanged;
bool autoEnter, submitThisHold;
unsigned session;
constexpr UINT Command=WM_APP+1;
constexpr UINT FinishPaste=WM_APP+2;
constexpr int ToggleAutoEnter=1;
void emit(const std::string& line) { std::cout << line << std::endl; }
bool pressed(int key) { return (GetAsyncKeyState(key)&0x8000)!=0; }
void emitNearWindow(const std::string& event, HWND window) {
    MONITORINFO monitor{sizeof(MONITORINFO)};
    GetMonitorInfoW(MonitorFromWindow(window,MONITOR_DEFAULTTOPRIMARY),&monitor);
    const auto& r=monitor.rcWork;
    emit(event+" "+std::to_string((r.left+r.right)/2)+" "+std::to_string((r.top+r.bottom)/2));
}
void pasteRead() {
    // Leave the synchronous clipboard rendering call before sending another key.
    if(!submitThisHold)emit("pasted");
    else if(!PostMessageW(owner,FinishPaste,session,0))emit("enter-skipped");
}

LRESULT CALLBACK keyboard(int code, WPARAM message, LPARAM data) {
    if(code!=HC_ACTION) return CallNextHookEx(nullptr,code,message,data);
    const auto& key=*reinterpret_cast<KBDLLHOOKSTRUCT*>(data);
    const bool down=message==WM_KEYDOWN || message==WM_SYSKEYDOWN;
    if(!(key.flags&LLKHF_INJECTED)) {
        if(key.vkCode==VK_RMENU) {
            if(down && !held && armed) {
                held=true; armed=false; chord=false; ++session;
                submitThisHold=autoEnter;
                // AltGr layouts generate a companion Left Ctrl keydown.
                forwardAlt=pressed(VK_LCONTROL);
                focusChanged=false; destination=GetForegroundWindow();
                GetWindowThreadProcessId(destination,&destinationPid);
                emitNearWindow("down "+std::to_string(session),destination);
            } else if(!down && held) {
                held=false;
                if(!chord) emit("up "+std::to_string(session));
                if(!forwardAlt) return 1;
            }
            if(held && !forwardAlt) return 1;
        } else if(down && held && !chord) {
            chord=true; emit("cancel "+std::to_string(session));
        }
    }
    return CallNextHookEx(nullptr,code,message,data);
}
void CALLBACK focus(HWINEVENTHOOK,DWORD,HWND window,LONG,LONG,DWORD,DWORD) {
    if(window!=destination) focusChanged=true;
}
LRESULT CALLBACK procedure(HWND window,UINT msg,WPARAM wp,LPARAM lp) {
    if(clipboard::handle(window,msg,wp,pasteRead))return 0;
    if(msg==WM_HOTKEY && wp==ToggleAutoEnter) {
        autoEnter=!autoEnter;
        if(!autoEnter)submitThisHold=false;
        emitNearWindow(autoEnter?"auto-enter on":"auto-enter off",GetForegroundWindow());
        return 0;
    }
    if(msg==FinishPaste) {
        DWORD pid=0;
        GetWindowThreadProcessId(GetForegroundWindow(),&pid);
        bool submit=wp==session && submitThisHold && autoEnter && !focusChanged &&
            GetForegroundWindow()==destination && pid==destinationPid && !clipboard::modifierDown() &&
            !pressed(VK_RETURN) && GetClipboardOwner()==owner &&
            GetClipboardSequenceNumber()==clipboard::sequence;
        submitThisHold=false;
        INPUT keys[2]{};
        for(auto& key:keys){key.type=INPUT_KEYBOARD;key.ki.wVk=VK_RETURN;}
        keys[1].ki.dwFlags=KEYEVENTF_KEYUP;
        emit(submit && SendInput(2,keys,sizeof(INPUT))==2?"pasted":"enter-skipped");
        return 0;
    }
    if(msg==Command) {
        std::unique_ptr<std::string> line(reinterpret_cast<std::string*>(lp));
        if(*line=="quit") PostQuitMessage(0);
        if(*line=="arm") armed=true;
#ifdef CHIRP_TEST_INPUT
        if(line->rfind("test-quit ",0)==0){
            if(reinterpret_cast<UINT_PTR>(GetForegroundWindow())!=std::stoull(line->substr(10))){
                emit("test-focus-error");return 0;
            }
            INPUT keys[4]{};
            WORD codes[]={VK_CONTROL,'Q','Q',VK_CONTROL};
            for(int i=0;i<4;i++){
                keys[i].type=INPUT_KEYBOARD;keys[i].ki.wVk=codes[i];
                if(i>=2)keys[i].ki.dwFlags=KEYEVENTF_KEYUP;
            }
            emit(SendInput(4,keys,sizeof(INPUT))==4?"quit-sent":"test-quit-error");
        }
        static std::vector<clipboard::Item> original;
        if(*line=="test-backup"){
            clipboard::discard();
            if(!OpenClipboard(owner)){emit("test-backup-error");return 0;}
            const bool ok=clipboard::save();
            CloseClipboard();
            if(ok)original=std::move(clipboard::prior);
            clipboard::discard(); emit(ok?"backup":"test-backup-error");
        }
        if(*line=="test-restore"){
            if(GetClipboardOwner()!=owner){emit("test-owner-changed");return 0;}
            clipboard::discard();
            clipboard::prior=std::move(original);
            clipboard::sequence=GetClipboardSequenceNumber();
            clipboard::waiting=true;clipboard::restore(owner);
            emit("restored");
        }
        if(*line=="test-private")emit(IsClipboardFormatAvailable(RegisterClipboardFormatW(L"ExcludeClipboardContentFromMonitorProcessing"))?"private":"test-privacy-error");
        if(*line=="arm")emit("armed");
        if(line->rfind("test-hold ",0)==0){
            const auto expected=std::stoull(line->substr(10));
            if(reinterpret_cast<UINT_PTR>(GetForegroundWindow())!=expected){emit("test-focus-error");return 0;}
            KBDLLHOOKSTRUCT key{}; key.vkCode=VK_RMENU; keyboard(HC_ACTION,WM_SYSKEYDOWN,(LPARAM)&key);
        }
        if(*line=="test-release"){
            KBDLLHOOKSTRUCT key{}; key.vkCode=VK_RMENU; keyboard(HC_ACTION,WM_SYSKEYUP,(LPARAM)&key);
        }
#endif
        if(line->rfind("paste ",0)==0){
            std::istringstream fields(line->substr(6));
            unsigned id; std::string hex;
            if(!(fields>>id>>hex)){emit("paste-error");return 0;}
            const auto text=clipboard::fromHex(hex);
            auto result=text.empty()?"paste-error":clipboard::deliver(owner,destination,destinationPid,
                 session==id && !focusChanged,text);
            if(result!="pending")emit(result);
        }
        return 0;
    }
    return DefWindowProcW(window,msg,wp,lp);
}
}
int main() {
    OleInitialize(nullptr);
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    auto instance=GetModuleHandleW(nullptr);
    WNDCLASSW cls{}; cls.hInstance=instance; cls.lpszClassName=L"ChirpInput"; cls.lpfnWndProc=procedure;
    RegisterClassW(&cls);
    owner=CreateWindowW(cls.lpszClassName,L"",0,0,0,0,0,nullptr,nullptr,instance,nullptr);
    auto keys=SetWindowsHookExW(WH_KEYBOARD_LL,keyboard,instance,0);
    auto changes=SetWinEventHook(EVENT_SYSTEM_FOREGROUND,EVENT_SYSTEM_FOREGROUND,nullptr,focus,0,0,WINEVENT_OUTOFCONTEXT);
    if(!owner || !keys || !changes) return 1;
    emit("connected");
    if(!RegisterHotKey(owner,ToggleAutoEnter,MOD_CONTROL|MOD_NOREPEAT,'B'))
        emitNearWindow("shortcut-unavailable Ctrl+B",GetForegroundWindow());
    std::thread([]{
        for(std::string line;std::getline(std::cin,line);) {
            auto cmd=std::make_unique<std::string>(line);
            if(PostMessageW(owner,Command,0,reinterpret_cast<LPARAM>(cmd.get()))) cmd.release();
            if(line=="quit")return;
        }
        PostMessageW(owner,Command,0,reinterpret_cast<LPARAM>(new std::string("quit")));
    }).detach();
    MSG message{};
    while(GetMessageW(&message,nullptr,0,0)>0) DispatchMessageW(&message);
    UnhookWinEvent(changes); UnhookWindowsHookEx(keys); DestroyWindow(owner);
    clipboard::discard(); OleUninitialize();
    return 0;
}
