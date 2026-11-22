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
unsigned session;
constexpr UINT Command=WM_APP+1;
void emit(const std::string& line) { std::cout << line << std::endl; }
bool pressed(int key) { return (GetAsyncKeyState(key)&0x8000)!=0; }

LRESULT CALLBACK keyboard(int code, WPARAM message, LPARAM data) {
    if(code!=HC_ACTION) return CallNextHookEx(nullptr,code,message,data);
    const auto& key=*reinterpret_cast<KBDLLHOOKSTRUCT*>(data);
    const bool down=message==WM_KEYDOWN || message==WM_SYSKEYDOWN;
    if(!(key.flags&LLKHF_INJECTED)) {
        if(key.vkCode==VK_RMENU) {
            if(down && !held && armed) {
                held=true; armed=false; chord=false; ++session;
                // AltGr layouts generate a companion Left Ctrl keydown.
                forwardAlt=pressed(VK_LCONTROL);
                focusChanged=false; destination=GetForegroundWindow();
                GetWindowThreadProcessId(destination,&destinationPid);
                MONITORINFO monitor{sizeof(MONITORINFO)};
                GetMonitorInfoW(MonitorFromWindow(destination,MONITOR_DEFAULTTOPRIMARY),&monitor);
                const auto& r=monitor.rcWork;
                emit("down "+std::to_string(session)+" "+std::to_string((r.left+r.right)/2)+" "+std::to_string((r.top+r.bottom)/2));
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
    if(clipboard::handle(window,msg,wp))return 0;
    if(msg==Command) {
        std::unique_ptr<std::string> line(reinterpret_cast<std::string*>(lp));
        if(*line=="quit") PostQuitMessage(0);
        if(*line=="arm") armed=true;
        if(line->rfind("paste ",0)==0){
            std::istringstream fields(line->substr(6));
            unsigned id; std::string hex;
            if(!(fields>>id>>hex)){emit("paste-error");return 0;}
            const auto text=clipboard::fromHex(hex);
            emit(text.empty()?"paste-error":clipboard::deliver(owner,destination,destinationPid,
                 session==id && !focusChanged,text));
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
