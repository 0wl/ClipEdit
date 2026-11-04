// ClipEditMenu.cpp
// Windows 11 top-level context menu entry "Edit with ClipEdit" for video files.
// IExplorerCommand COM server hosted by a packaged (MSIX) COM surrogate.
// Adapted from the earlier ClaudeContextMenu project.
//
// The executable to launch is read at runtime from
//   HKCU\Software\ClipEdit   ExePath (REG_SZ), ExeArgs (REG_SZ, optional)
// which ClipEdit writes when "Add to context menu" is enabled, so the DLL has
// no hard-coded paths and survives reinstalls / moves.
//
// CLSID {1734921E-184F-4E77-BB8A-1A0D3DE23586}

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shobjidl_core.h>
#include <shlwapi.h>
#include <shellapi.h>
#include <shlobj_core.h>
#include <strsafe.h>
#include <wrl/module.h>
#include <wrl/implements.h>
#include <wrl/client.h>
#include <string>

using namespace Microsoft::WRL;

#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "advapi32.lib")

namespace {

constexpr PCWSTR kRegKey   = L"Software\\ClipEdit";
constexpr PCWSTR kTitle    = L"Edit with ClipEdit";
constexpr PCWSTR kTooltip  = L"Trim this video in ClipEdit";

std::wstring ReadRegString(PCWSTR name)
{
    DWORD bytes = 0;
    if (RegGetValueW(HKEY_CURRENT_USER, kRegKey, name, RRF_RT_REG_SZ, nullptr, nullptr, &bytes) != ERROR_SUCCESS || bytes == 0)
        return {};
    std::wstring s(bytes / sizeof(wchar_t), L'\0');
    if (RegGetValueW(HKEY_CURRENT_USER, kRegKey, name, RRF_RT_REG_SZ, nullptr, s.data(), &bytes) != ERROR_SUCCESS)
        return {};
    s.resize(wcsnlen(s.c_str(), s.size()));
    return s;
}

bool FileExists(const std::wstring& p)
{
    DWORD a = GetFileAttributesW(p.c_str());
    return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}

// ClipEdit.exe location: registry first, then the default per-user install dir.
std::wstring ResolveExe()
{
    std::wstring exe = ReadRegString(L"ExePath");
    if (!exe.empty() && FileExists(exe)) return exe;

    PWSTR local = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local))) {
        std::wstring p = std::wstring(local) + L"\\Programs\\clipedit\\ClipEdit.exe";
        CoTaskMemFree(local);
        if (FileExists(p)) return p;
    }
    return {};
}

HRESULT FirstPath(IShellItemArray* psia, std::wstring& out)
{
    if (!psia) return E_INVALIDARG;
    DWORD count = 0;
    HRESULT hr = psia->GetCount(&count);
    if (FAILED(hr) || count == 0) return E_FAIL;
    ComPtr<IShellItem> item;
    hr = psia->GetItemAt(0, &item);
    if (FAILED(hr)) return hr;
    PWSTR psz = nullptr;
    hr = item->GetDisplayName(SIGDN_FILESYSPATH, &psz);
    if (FAILED(hr)) return hr;
    out.assign(psz);
    CoTaskMemFree(psz);
    return S_OK;
}

class __declspec(uuid("1734921E-184F-4E77-BB8A-1A0D3DE23586"))
ClipEditCommand : public RuntimeClass<RuntimeClassFlags<ClassicCom>, IExplorerCommand>
{
public:
    IFACEMETHODIMP GetTitle(IShellItemArray*, LPWSTR* ppszName) override
    {
        return SHStrDupW(kTitle, ppszName);
    }

    IFACEMETHODIMP GetIcon(IShellItemArray*, LPWSTR* ppszIcon) override
    {
        *ppszIcon = nullptr;
        std::wstring exe = ResolveExe();
        if (exe.empty()) return E_NOTIMPL;
        exe += L",0";
        return SHStrDupW(exe.c_str(), ppszIcon);
    }

    IFACEMETHODIMP GetToolTip(IShellItemArray*, LPWSTR* ppszTip) override
    {
        return SHStrDupW(kTooltip, ppszTip);
    }

    IFACEMETHODIMP GetCanonicalName(GUID* pguid) override
    {
        *pguid = __uuidof(ClipEditCommand);
        return S_OK;
    }

    IFACEMETHODIMP GetState(IShellItemArray*, BOOL, EXPCMDSTATE* pState) override
    {
        // Hidden until ClipEdit has registered where it lives.
        *pState = ResolveExe().empty() ? ECS_HIDDEN : ECS_ENABLED;
        return S_OK;
    }

    IFACEMETHODIMP GetFlags(EXPCMDFLAGS* pFlags) override
    {
        *pFlags = ECF_DEFAULT;
        return S_OK;
    }

    IFACEMETHODIMP EnumSubCommands(IEnumExplorerCommand** ppEnum) override
    {
        *ppEnum = nullptr;
        return E_NOTIMPL;
    }

    IFACEMETHODIMP Invoke(IShellItemArray* psia, IBindCtx*) override
    {
        std::wstring path;
        HRESULT hr = FirstPath(psia, path);
        if (FAILED(hr)) return hr;

        std::wstring exe = ResolveExe();
        if (exe.empty()) return HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND);

        std::wstring args = ReadRegString(L"ExeArgs");
        if (!args.empty()) args += L" ";
        args += L"\"" + path + L"\"";

        wchar_t dir[MAX_PATH];
        StringCchCopyW(dir, MAX_PATH, path.c_str());
        PathRemoveFileSpecW(dir);

        SHELLEXECUTEINFOW sei = { sizeof(sei) };
        sei.fMask        = SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
        sei.lpFile       = exe.c_str();
        sei.lpParameters = args.c_str();
        sei.lpDirectory  = dir;
        sei.nShow        = SW_SHOWNORMAL;
        if (!ShellExecuteExW(&sei)) return HRESULT_FROM_WIN32(GetLastError());
        return S_OK;
    }
};

CoCreatableClass(ClipEditCommand);

} // namespace

STDAPI DllCanUnloadNow()
{
    return Module<InProc>::GetModule().GetObjectCount() == 0 ? S_OK : S_FALSE;
}

STDAPI DllGetClassObject(REFCLSID rclsid, REFIID riid, _COM_Outptr_ void** ppv)
{
    return Module<InProc>::GetModule().GetClassObject(rclsid, riid, ppv);
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID)
{
    if (reason == DLL_PROCESS_ATTACH) DisableThreadLibraryCalls(hModule);
    return TRUE;
}
