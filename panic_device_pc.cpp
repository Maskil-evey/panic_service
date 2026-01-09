// esp32_simulator.cpp
#include <iostream>
#include <string>
#include <thread>
#include <chrono>
#include <atomic>
#include <windows.h>
#include <winhttp.h>
#include <json/json.h>

#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "jsoncpp.lib")

class ESP32Simulator {
private:
    std::string bridgeUrl;
    std::string deviceId;
    std::atomic<bool> isAlerting;
    std::atomic<bool> shouldRun;
    std::atomic<bool> buzzerState;
    std::string currentPanicId;
    std::string residentName;
    std::string address;
    std::string phone;
    HANDLE consoleHandle;
    
public:
    ESP32Simulator(const std::string& url = "http://localhost:5005", 
                   const std::string& id = "panic-device-01")
        : bridgeUrl(url), deviceId(id), isAlerting(false), shouldRun(true), 
          buzzerState(false), consoleHandle(GetStdHandle(STD_OUTPUT_HANDLE)) {}
    
    ~ESP32Simulator() {
        shouldRun = false;
    }
    
    void setColor(int color) {
        SetConsoleTextAttribute(consoleHandle, color);
    }
    
    void resetColor() {
        setColor(7); // Default gray
    }
    
    void clearScreen() {
        system("cls");
    }
    
    void displayLogo() {
        clearScreen();
        setColor(10); // Green
        std::cout << "=========================================\n";
        std::cout << "        ESP32 PANIC SYSTEM SIMULATOR    \n";
        std::cout << "=========================================\n";
        resetColor();
        std::cout << "Device ID: " << deviceId << "\n";
        std::cout << "Bridge URL: " << bridgeUrl << "\n";
        std::cout << "Status: IDLE\n";
        std::cout << "=========================================\n\n";
    }
    
    void displayAlert() {
        clearScreen();
        setColor(12); // Red background for alert
        for(int i = 0; i < 50; i++) std::cout << "=";
        std::cout << "\n";
        
        setColor(14); // Yellow text
        std::cout << "               🚨 PANIC ALERT! 🚨           \n";
        
        setColor(12);
        for(int i = 0; i < 50; i++) std::cout << "=";
        std::cout << "\n\n";
        
        setColor(15); // White text
        std::cout << "  Resident: " << residentName << "\n";
        std::cout << "  Address:  " << address << "\n";
        std::cout << "  Phone:    " << phone << "\n";
        std::cout << "  Panic ID: " << currentPanicId << "\n\n";
        
        setColor(14);
        std::cout << "  [A] Acknowledge Alert\n";
        std::cout << "  [I] Ignore\n";
        
        setColor(12);
        for(int i = 0; i < 50; i++) std::cout << "=";
        std::cout << "\n";
        
        if (buzzerState) {
            setColor(10);
            std::cout << "  BUZZER: ON 🔔\n";
        } else {
            setColor(8);
            std::cout << "  BUZZER: OFF 🔕\n";
        }
        resetColor();
    }
    
    std::string httpGet(const std::string& url) {
        HINTERNET hSession = NULL;
        HINTERNET hConnect = NULL;
        HINTERNET hRequest = NULL;
        std::string response;
        
        try {
            // Parse URL
            URL_COMPONENTS urlComp;
            ZeroMemory(&urlComp, sizeof(urlComp));
            urlComp.dwStructSize = sizeof(urlComp);
            
            urlComp.dwSchemeLength = -1;
            urlComp.dwHostNameLength = -1;
            urlComp.dwUrlPathLength = -1;
            urlComp.dwExtraInfoLength = -1;
            
            if (!WinHttpCrackUrl(url.c_str(), url.length(), 0, &urlComp)) {
                throw std::runtime_error("Failed to parse URL");
            }
            
            std::wstring host(urlComp.lpszHostName, urlComp.dwHostNameLength);
            std::wstring path(urlComp.lpszUrlPath, urlComp.dwUrlPathLength);
            
            // Initialize WinHTTP
            hSession = WinHttpOpen(L"ESP32 Simulator/1.0", 
                                   WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                   WINHTTP_NO_PROXY_NAME,
                                   WINHTTP_NO_PROXY_BYPASS, 0);
            if (!hSession) throw std::runtime_error("WinHttpOpen failed");
            
            // Connect
            hConnect = WinHttpConnect(hSession, host.c_str(), 
                                     urlComp.nPort, 0);
            if (!hConnect) throw std::runtime_error("WinHttpConnect failed");
            
            // Open request
            hRequest = WinHttpOpenRequest(hConnect, L"GET", path.c_str(),
                                         NULL, WINHTTP_NO_REFERER,
                                         WINHTTP_DEFAULT_ACCEPT_TYPES,
                                         (urlComp.nScheme == INTERNET_SCHEME_HTTPS) ? 
                                         WINHTTP_FLAG_SECURE : 0);
            if (!hRequest) throw std::runtime_error("WinHttpOpenRequest failed");
            
            // Send request
            if (!WinHttpSendRequest(hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                                   WINHTTP_NO_REQUEST_DATA, 0, 0, 0)) {
                throw std::runtime_error("WinHttpSendRequest failed");
            }
            
            // Receive response
            if (!WinHttpReceiveResponse(hRequest, NULL)) {
                throw std::runtime_error("WinHttpReceiveResponse failed");
            }
            
            // Read response data
            DWORD size = 0;
            do {
                DWORD downloaded = 0;
                char buffer[4096];
                
                if (!WinHttpQueryDataAvailable(hRequest, &size)) {
                    throw std::runtime_error("WinHttpQueryDataAvailable failed");
                }
                
                if (size == 0) break;
                
                ZeroMemory(buffer, 4096);
                if (!WinHttpReadData(hRequest, buffer, size, &downloaded)) {
                    throw std::runtime_error("WinHttpReadData failed");
                }
                
                response.append(buffer, downloaded);
            } while (size > 0);
            
        } catch (const std::exception& e) {
            std::cerr << "HTTP Error: " << e.what() << std::endl;
            response = "";
        }
        
        // Cleanup
        if (hRequest) WinHttpCloseHandle(hRequest);
        if (hConnect) WinHttpCloseHandle(hConnect);
        if (hSession) WinHttpCloseHandle(hSession);
        
        return response;
    }
    
    std::string httpPost(const std::string& url, const std::string& data) {
        HINTERNET hSession = NULL;
        HINTERNET hConnect = NULL;
        HINTERNET hRequest = NULL;
        std::string response;
        
        try {
            // Parse URL
            URL_COMPONENTS urlComp;
            ZeroMemory(&urlComp, sizeof(urlComp));
            urlComp.dwStructSize = sizeof(urlComp);
            
            urlComp.dwSchemeLength = -1;
            urlComp.dwHostNameLength = -1;
            urlComp.dwUrlPathLength = -1;
            urlComp.dwExtraInfoLength = -1;
            
            if (!WinHttpCrackUrl(url.c_str(), url.length(), 0, &urlComp)) {
                throw std::runtime_error("Failed to parse URL");
            }
            
            std::wstring host(urlComp.lpszHostName, urlComp.dwHostNameLength);
            std::wstring path(urlComp.lpszUrlPath, urlComp.dwUrlPathLength);
            
            // Initialize WinHTTP
            hSession = WinHttpOpen(L"ESP32 Simulator/1.0", 
                                   WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                   WINHTTP_NO_PROXY_NAME,
                                   WINHTTP_NO_PROXY_BYPASS, 0);
            if (!hSession) throw std::runtime_error("WinHttpOpen failed");
            
            // Connect
            hConnect = WinHttpConnect(hSession, host.c_str(), 
                                     urlComp.nPort, 0);
            if (!hConnect) throw std::runtime_error("WinHttpConnect failed");
            
            // Open request
            hRequest = WinHttpOpenRequest(hConnect, L"POST", path.c_str(),
                                         NULL, WINHTTP_NO_REFERER,
                                         WINHTTP_DEFAULT_ACCEPT_TYPES,
                                         (urlComp.nScheme == INTERNET_SCHEME_HTTPS) ? 
                                         WINHTTP_FLAG_SECURE : 0);
            if (!hRequest) throw std::runtime_error("WinHttpOpenRequest failed");
            
            // Set headers
            std::wstring headers = L"Content-Type: application/json\r\n";
            if (!WinHttpAddRequestHeaders(hRequest, headers.c_str(), headers.length(),
                                         WINHTTP_ADDREQ_FLAG_ADD)) {
                throw std::runtime_error("WinHttpAddRequestHeaders failed");
            }
            
            // Send request
            if (!WinHttpSendRequest(hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                                   (LPVOID)data.c_str(), data.length(),
                                   data.length(), 0)) {
                throw std::runtime_error("WinHttpSendRequest failed");
            }
            
            // Receive response
            if (!WinHttpReceiveResponse(hRequest, NULL)) {
                throw std::runtime_error("WinHttpReceiveResponse failed");
            }
            
            // Read response data
            DWORD size = 0;
            do {
                DWORD downloaded = 0;
                char buffer[4096];
                
                if (!WinHttpQueryDataAvailable(hRequest, &size)) {
                    throw std::runtime_error("WinHttpQueryDataAvailable failed");
                }
                
                if (size == 0) break;
                
                ZeroMemory(buffer, 4096);
                if (!WinHttpReadData(hRequest, buffer, size, &downloaded)) {
                    throw std::runtime_error("WinHttpReadData failed");
                }
                
                response.append(buffer, downloaded);
            } while (size > 0);
            
        } catch (const std::exception& e) {
            std::cerr << "HTTP Error: " << e.what() << std::endl;
            response = "";
        }
        
        // Cleanup
        if (hRequest) WinHttpCloseHandle(hRequest);
        if (hConnect) WinHttpCloseHandle(hConnect);
        if (hSession) WinHttpCloseHandle(hSession);
        
        return response;
    }
    
    bool checkForAlarm() {
        std::string url = bridgeUrl + "/check-alarm";
        std::string response = httpGet(url);
        
        if (response.empty()) {
            return false;
        }
        
        // Parse JSON response
        Json::CharReaderBuilder readerBuilder;
        Json::Value root;
        std::string errors;
        std::istringstream s(response);
        
        if (!Json::parseFromStream(readerBuilder, s, &root, &errors)) {
            std::cerr << "JSON parse error: " << errors << std::endl;
            return false;
        }
        
        if (root["active"].asBool()) {
            std::string panicId = root["panicId"].asString();
            
            if (panicId != currentPanicId) {
                currentPanicId = panicId;
                residentName = root["resident"]["name"].asString();
                address = root["resident"]["flat"].asString();
                phone = root["resident"]["phone"].asString();
                
                isAlerting = true;
                return true;
            }
        }
        
        return false;
    }
    
    void acknowledgeAlarm() {
        if (!currentPanicId.empty()) {
            std::string url = bridgeUrl + "/acknowledge";
            std::string json = "{\"panicId\":\"" + currentPanicId + "\"}";
            
            std::string response = httpPost(url, json);
            
            if (!response.empty()) {
                Json::CharReaderBuilder readerBuilder;
                Json::Value root;
                std::string errors;
                std::istringstream s(response);
                
                if (Json::parseFromStream(readerBuilder, s, &root, &errors)) {
                    if (root["success"].asBool()) {
                        std::cout << "Alarm acknowledged successfully!\n";
                    }
                }
            }
            
            // Reset state
            isAlerting = false;
            currentPanicId = "";
            buzzerState = false;
            displayLogo();
        }
    }
    
    void simulateBuzzer() {
        while (shouldRun) {
            if (isAlerting && buzzerState) {
                Beep(1000, 500);  // 1000Hz for 500ms
                std::this_thread::sleep_for(std::chrono::milliseconds(500));
                buzzerState = !buzzerState;
            } else {
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
        }
    }
    
    void pollingThread() {
        while (shouldRun) {
            if (!isAlerting) {
                if (checkForAlarm()) {
                    buzzerState = true;
                    displayAlert();
                }
            }
            std::this_thread::sleep_for(std::chrono::seconds(2));
        }
    }
    
    void run() {
        clearScreen();
        displayLogo();
        
        // Start buzzer thread
        std::thread buzzerThread(&ESP32Simulator::simulateBuzzer, this);
        
        // Start polling thread
        std::thread pollThread(&ESP32Simulator::pollingThread, this);
        
        std::cout << "Simulator running. Commands:\n";
        std::cout << "  [A] Acknowledge current alarm\n";
        std::cout << "  [C] Check for alarms manually\n";
        std::cout << "  [R] Reset display\n";
        std::cout << "  [Q] Quit\n\n";
        
        while (shouldRun) {
            if (GetAsyncKeyState('A') & 0x8000) {
                if (isAlerting) {
                    acknowledgeAlarm();
                }
                Sleep(300);  // Debounce
            }
            else if (GetAsyncKeyState('C') & 0x8000) {
                if (!isAlerting) {
                    checkForAlarm();
                    if (isAlerting) {
                        buzzerState = true;
                        displayAlert();
                    }
                }
                Sleep(300);
            }
            else if (GetAsyncKeyState('R') & 0x8000) {
                isAlerting = false;
                buzzerState = false;
                displayLogo();
                Sleep(300);
            }
            else if (GetAsyncKeyState('Q') & 0x8000) {
                shouldRun = false;
                break;
            }
            
            // Update display if alerting and buzzer state changed
            static bool lastBuzzerState = false;
            if (isAlerting && buzzerState != lastBuzzerState) {
                displayAlert();
                lastBuzzerState = buzzerState;
            }
            
            Sleep(50);  // Small delay to reduce CPU usage
        }
        
        // Cleanup threads
        buzzerThread.join();
        pollThread.join();
        
        clearScreen();
        std::cout << "ESP32 Simulator terminated.\n";
    }
};

int main() {
    // Configuration
    std::string bridgeUrl;
    std::cout << "Enter bridge URL (default: http://localhost:5005): ";
    std::getline(std::cin, bridgeUrl);
    
    if (bridgeUrl.empty()) {
        bridgeUrl = "http://localhost:5005";
    }
    
    std::string deviceId;
    std::cout << "Enter device ID (default: panic-device-01): ";
    std::getline(std::cin, deviceId);
    
    if (deviceId.empty()) {
        deviceId = "panic-device-01";
    }
    
    // Create and run simulator
    ESP32Simulator simulator(bridgeUrl, deviceId);
    simulator.run();
    
    return 0;
}