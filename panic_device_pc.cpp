#include <iostream>
#include <windows.h>
#include <winhttp.h>
#include <string>
#include <thread>

#pragma comment(lib, "winhttp.lib")

// Simple function to extract a string value from JSON
std::string extractJsonValue(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\":";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return "";
    pos += search.length();

    // Skip whitespace and quotes
    while (pos < json.size() && (json[
        pos] == ' ' || json[pos] == '\"')) ++pos;

    size_t end = json.find_first_of(",}\"", pos);
    std::string value = json.substr(pos, end - pos);

    // Remove trailing quotes if any
    if (!value.empty() && value.back() == '"') value.pop_back();

    return value;
}

// Simple function to get boolean from JSON
bool extractJsonBool(const std::string& json, const std::string& key) {
    std::string val = extractJsonValue(json, key);
    return val == "true";
}

// HTTP GET using WinHTTP
std::string httpGet(const std::wstring& host, int port, const std::wstring& path) {
    HINTERNET hSession = WinHttpOpen(L"PanicDevice/1.0",
        WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
        WINHTTP_NO_PROXY_NAME,
        WINHTTP_NO_PROXY_BYPASS, 0);

    HINTERNET hConnect = WinHttpConnect(hSession, host.c_str(), port, 0);
    HINTERNET hRequest = WinHttpOpenRequest(
        hConnect, L"GET", path.c_str(),
        NULL, WINHTTP_NO_REFERER,
        WINHTTP_DEFAULT_ACCEPT_TYPES, 0
    );

    WinHttpSendRequest(hRequest,
        WINHTTP_NO_ADDITIONAL_HEADERS, 0,
        WINHTTP_NO_REQUEST_DATA, 0, 0, 0);

    WinHttpReceiveResponse(hRequest, NULL);

    std::string response;
    DWORD size = 0;
    do {
        DWORD downloaded = 0;
        WinHttpQueryDataAvailable(hRequest, &size);
        if (!size) break;

        char buffer[1024];
        WinHttpReadData(hRequest, buffer, size, &downloaded);
        response.append(buffer, downloaded);
    } while (size > 0);

    WinHttpCloseHandle(hRequest);
    WinHttpCloseHandle(hConnect);
    WinHttpCloseHandle(hSession);

    return response;
}

int main() {
    // Fix emoji/UTF-8 output
    SetConsoleOutputCP(CP_UTF8);

    std::cout << "🖥️ Panic Device PC Emulator Started\n";

    while (true) {
        std::string jsonStr = httpGet(L"127.0.0.1", 5005, L"/check-alarm");

        try {
            bool active = extractJsonBool(jsonStr, "active");

            if (active) {
                std::string name = extractJsonValue(jsonStr, "name");
                std::string flat = extractJsonValue(jsonStr, "flat");

                std::cout << "\n🚨 PANIC ALERT 🚨\n";
                std::cout << "Resident: " << name << "\n";
                std::cout << "Flat: " << flat << "\n";
            } else {
                std::cout << "✔ Waiting...\n";
            }
        } catch (...) {
            std::cout << "⚠ Invalid JSON received: " << jsonStr << "\n";
        }

        std::this_thread::sleep_for(std::chrono::seconds(2));
    }
}
