#include <windows.h>
#include <iostream>
#include <string>
#include "../native/windows/clipboard.hpp"

// Exercise real Win32 clipboard handles on an isolated window station.
int main() {
    auto station=CreateWindowStationW(nullptr,0,WINSTA_ALL_ACCESS,nullptr);
    if(!station || !SetProcessWindowStation(station))return 1;
    auto desktop=CreateDesktopW(L"ChirpTest",nullptr,nullptr,0,GENERIC_ALL,nullptr);
    if(!desktop || !SetThreadDesktop(desktop))return 2;
    OleInitialize(nullptr);
    HWND window=CreateWindowW(L"STATIC",L"Chirp QA",0,0,0,0,0,nullptr,nullptr,GetModuleHandleW(nullptr),nullptr);
    if(!window || !OpenClipboard(window) || !EmptyClipboard())return 3;
    struct { BITMAPINFOHEADER header{}; DWORD pixel=0x0072C29C; } image;
    image.header.biSize=sizeof(BITMAPINFOHEADER);
    image.header.biWidth=image.header.biHeight=1;
    image.header.biPlanes=1; image.header.biBitCount=32;
    if(!clipboard::publish(CF_DIB,&image,sizeof(image)) || !clipboard::save())return 4;
    if(!EmptyClipboard() || !clipboard::publish(CF_UNICODETEXT,L"QA",6))return 5;
    CloseClipboard();
    clipboard::waiting=true; clipboard::sequence=GetClipboardSequenceNumber();
    clipboard::restore(window);
    if(!OpenClipboard(window))return 6;
    HANDLE data=GetClipboardData(CF_DIB);
    const auto* dib=static_cast<const unsigned char*>(GlobalLock(data));
    if(!dib || memcmp(dib,&image,sizeof(image))!=0)return 7;
    GlobalUnlock(data);
    if(!clipboard::save() || !EmptyClipboard() || !clipboard::publish(CF_UNICODETEXT,L"QA",6))return 8;
    CloseClipboard();
    clipboard::waiting=true; clipboard::sequence=GetClipboardSequenceNumber();
    if(!OpenClipboard(window) || !EmptyClipboard() || !clipboard::publish(CF_UNICODETEXT,L"New",8))return 9;
    CloseClipboard();
    clipboard::restore(window);
    if(!OpenClipboard(window))return 10;
    data=GetClipboardData(CF_UNICODETEXT);
    auto* text=static_cast<const wchar_t*>(GlobalLock(data));
    if(!text || wcscmp(text,L"New")!=0)return 11;
    GlobalUnlock(data); CloseClipboard();
    DestroyWindow(window); OleUninitialize();
    std::cout<<"Image restoration and preservation of newer clipboard content passed.\n";
    return 0;
}
