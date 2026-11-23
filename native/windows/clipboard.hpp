#pragma once
#include <ole2.h>
#include <vector>

namespace clipboard {
using Item=std::pair<UINT,HANDLE>;
std::vector<Item> prior;
std::wstring delayed;
DWORD readerPid, sequence;
bool waiting;
int retries;
constexpr UINT Timer=71;
constexpr UINT ReadTimeout=72;
bool awaitingRead=false;
void discard() {
    for(auto [fmt,handle]:prior) {
        if(!handle) continue;
        if(fmt==CF_BITMAP || fmt==CF_DSPBITMAP || fmt==CF_PALETTE) DeleteObject(handle);
        else if(fmt==CF_ENHMETAFILE || fmt==CF_DSPENHMETAFILE) DeleteEnhMetaFile((HENHMETAFILE)handle);
        else GlobalFree(handle);
    }
    prior.clear(); waiting=false;
}
bool save() {
    for(UINT f=EnumClipboardFormats(0);f;f=EnumClipboardFormats(f)) {
        if(f==CF_METAFILEPICT || f==CF_DSPMETAFILEPICT || f==CF_OWNERDISPLAY ||
           (f>=CF_PRIVATEFIRST && f<=CF_GDIOBJLAST)) return false;
        HANDLE data=GetClipboardData(f);
        HANDLE copy=data?OleDuplicateData(data,(CLIPFORMAT)f,0):nullptr;
        if(!copy) return false;
        prior.emplace_back(f,copy);
    }
    return true;
}
bool publish(UINT format,const void* value,size_t bytes) {
    HGLOBAL data=GlobalAlloc(GMEM_MOVEABLE,bytes);
    if(!data)return false;
    if(void* p=GlobalLock(data)) {
        CopyMemory(p,value,bytes); GlobalUnlock(data);
        if(SetClipboardData(format,data))return true;
    }
    GlobalFree(data); return false;
}
bool render() {
    if(delayed.empty())return false;
    if(!publish(CF_UNICODETEXT,delayed.c_str(),(delayed.size()+1)*sizeof(wchar_t)))return false;
    delayed.clear(); return true;
}
void restore(HWND owner) {
    if(!waiting || GetClipboardOwner()!=owner || GetClipboardSequenceNumber()!=sequence) {
        KillTimer(owner,Timer); discard(); return;
    }
    if(!OpenClipboard(owner)) {
        if(++retries>25){KillTimer(owner,Timer);discard();} return;
    }
    auto saved=std::move(prior);
    if(GetClipboardSequenceNumber()==sequence && EmptyClipboard())
        for(auto& entry:saved) {
            if(SetClipboardData(entry.first,entry.second))entry.second=nullptr;
        }
    CloseClipboard(); prior=std::move(saved); discard(); KillTimer(owner,Timer);
}
bool handle(HWND owner,UINT msg,WPARAM wp,void (*onPasted)()=nullptr) {
    if(msg==WM_RENDERFORMAT && wp==CF_UNICODETEXT) {
        DWORD pid=0; GetWindowThreadProcessId(GetOpenClipboardWindow(),&pid);
        // Chromium can call OpenClipboard(nullptr), giving the reader no HWND.
        if(!pid)GetWindowThreadProcessId(GetForegroundWindow(),&pid);
        if(render() && waiting && pid==readerPid) {
            sequence=GetClipboardSequenceNumber(); retries=0; SetTimer(owner,Timer,160,nullptr);
            if(awaitingRead){
                awaitingRead=false; KillTimer(owner,ReadTimeout);
                if(onPasted)onPasted();
                else std::cout<<"pasted"<<std::endl;
            }
        }
        return true;
    }
    if(msg==WM_RENDERALLFORMATS && OpenClipboard(owner)){
        if(GetClipboardOwner()==owner)render();
        CloseClipboard(); return true;
    }
    if(msg==WM_DESTROYCLIPBOARD){
        if(awaitingRead){awaitingRead=false;std::cout<<"clipboard-changed"<<std::endl;}
        KillTimer(owner,ReadTimeout);
        delayed.clear();discard();KillTimer(owner,Timer);return true;
    }
    if(msg==WM_TIMER && wp==ReadTimeout){
        KillTimer(owner,ReadTimeout);
        if(awaitingRead){
            awaitingRead=false;discard();
            std::cout<<"copied"<<std::endl;
        }
        return true;
    }
    if(msg==WM_TIMER && wp==Timer){restore(owner);return true;}
    return false;
}
bool modifierDown() {
    for(int vk:{VK_MENU,VK_CONTROL,VK_SHIFT,VK_LWIN,VK_RWIN})
        if(GetAsyncKeyState(vk)&0x8000)return true;
    return false;
}
bool shortcut(bool terminal) {
    if(modifierDown())return false;
    std::vector<INPUT> input;
    auto key=[&](WORD vk,DWORD flags){INPUT i{};i.type=INPUT_KEYBOARD;i.ki.wVk=vk;i.ki.dwFlags=flags;input.push_back(i);};
    key(VK_CONTROL,0); if(terminal)key(VK_SHIFT,0); key('V',0);key('V',KEYEVENTF_KEYUP);
    if(terminal)key(VK_SHIFT,KEYEVENTF_KEYUP);key(VK_CONTROL,KEYEVENTF_KEYUP);
    return SendInput((UINT)input.size(),input.data(),sizeof(INPUT))==input.size();
}
std::string deliver(HWND owner,HWND target,DWORD pid,bool automatic,const std::wstring& text) {
    if(!OpenClipboard(owner))return "busy";
    discard();
    wchar_t cls[100]{};GetClassNameW(target,cls,100);
    const bool terminal=wcscmp(cls,L"CASCADIA_HOSTING_WINDOW_CLASS")==0;
    const bool console=wcscmp(cls,L"ConsoleWindowClass")==0;
    if((terminal||console) && text.find_first_of(L"\r\n")!=std::wstring::npos)automatic=false;
    automatic=automatic && target && target==GetForegroundWindow() && save();
    auto saved=std::move(prior);
    DWORD marker=0;
    bool ok=EmptyClipboard() && publish(RegisterClipboardFormatW(L"ExcludeClipboardContentFromMonitorProcessing"),&marker,sizeof(marker));
    if(ok){
        delayed=text;
        if(automatic){SetClipboardData(CF_UNICODETEXT,nullptr);ok=IsClipboardFormatAvailable(CF_UNICODETEXT);}
        else ok=render();
    }
    CloseClipboard(); prior=std::move(saved);
    if(!ok){discard();return "paste-error";}
    waiting=automatic; readerPid=pid;
    if(automatic && GetForegroundWindow()==target && shortcut(terminal)){
        awaitingRead=true; SetTimer(owner,ReadTimeout,1500,nullptr); return "pending";
    }
    discard();return "copied";
}
std::wstring fromHex(const std::string& hex) {
    if(hex.empty() || hex.size()%2)return {};
    std::string bytes;
    for(size_t i=0;i<hex.size();i+=2){
        int value=0;
        for(size_t j=i;j<i+2;j++){char c=hex[j];if(!isxdigit((unsigned char)c))return {};
            value=value*16+(isdigit((unsigned char)c)?c-'0':tolower((unsigned char)c)-'a'+10);}
        if(!value)return {};bytes.push_back((char)value);
    }
    int n=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,bytes.data(),(int)bytes.size(),nullptr,0);
    std::wstring out(n,L'\0');
    if(n)MultiByteToWideChar(CP_UTF8,0,bytes.data(),(int)bytes.size(),out.data(),n);
    return out;
}
}
