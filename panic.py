import requests
from flask import Flask, jsonify, request
from flask_cors import CORS
import time
import threading
from datetime import datetime

app = Flask(__name__)
CORS(app)

# --- CONFIGURATION ---
DEVICE_ID = "panic-device-01"
PRODUCTION_BASE_URL = "https://panic-service.onrender.com"  # Base URL without /api

# Keep track of current active panic
CURRENT_PANIC = {
    "active": False,
    "panicId": None,
    "resident_name": None,
    "address": None,
    "phone": None,
    "delivered_at": None,
    "acknowledged": False
}

state_lock = threading.Lock()

def poll_production_api():
    """Poll production API for new panics targeted at this device"""
    global CURRENT_PANIC
    
    while True:
        try:
            # Poll the production endpoint with deviceId parameter
            response = requests.get(
                f"{PRODUCTION_BASE_URL}/api/device/panic",
                params={"deviceId": DEVICE_ID},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                
                with state_lock:
                    if data.get("panic") == True:
                        event = data.get("event", {})
                        new_panic_id = event.get("panicId")
                        
                        # Only update if we don't already have this panic
                        if new_panic_id != CURRENT_PANIC["panicId"]:
                            CURRENT_PANIC.update({
                                "active": True,
                                "panicId": new_panic_id,
                                "resident_name": event.get("residentName", "Unknown"),
                                "address": event.get("address", "Unknown"),
                                "phone": event.get("phoneNumber", "Unknown"),
                                "delivered_at": datetime.now().isoformat(),
                                "acknowledged": False
                            })
                            print(f"🚨 NEW PANIC RECEIVED: {CURRENT_PANIC['resident_name']} at {CURRENT_PANIC['address']}")
                            
                    else:
                        # If API returns no panic, check if we should clear our local state
                        if CURRENT_PANIC["active"]:
                            # Query the panic status directly
                            try:
                                status_response = requests.get(
                                    f"{PRODUCTION_BASE_URL}/api/panic/{CURRENT_PANIC['panicId']}",
                                    timeout=5
                                )
                                
                                if status_response.status_code == 200:
                                    panic_data = status_response.json()
                                    
                                    # If panic is acknowledged in Express API, sync our state
                                    if panic_data.get("status") == "acknowledged":
                                        CURRENT_PANIC["acknowledged"] = True
                                        print(f"🔄 SYNC: Panic {CURRENT_PANIC['panicId']} is acknowledged in Express API")
                                        
                                    # If panic doesn't exist or is very old, clear it
                                    delivered_time = datetime.fromisoformat(CURRENT_PANIC["delivered_at"])
                                    time_diff = (datetime.now() - delivered_time).total_seconds()
                                    if time_diff > 35:  # Just after auto-ack timeout
                                        CURRENT_PANIC.update({
                                            "active": False,
                                            "panicId": None,
                                            "resident_name": None,
                                            "address": None,
                                            "phone": None,
                                            "delivered_at": None,
                                            "acknowledged": False
                                        })
                                        print(f"🧹 Cleared panic after {time_diff:.0f}s")
                                        
                            except Exception as e:
                                print(f"⚠️ Failed to check panic status: {str(e)}")
                            
        except requests.exceptions.Timeout:
            print("⏰ Production API timeout")
        except requests.exceptions.ConnectionError:
            print("🔌 Cannot connect to Production API")
        except Exception as e:
            print(f"❌ API Polling Error: {str(e)}")
        
        time.sleep(3)  # Poll every 3 seconds 

# Start polling thread
polling_thread = threading.Thread(target=poll_production_api, daemon=True)
polling_thread.start()

# --- ESP32 ENDPOINTS ---

@app.route("/check-alarm", methods=["GET"])
def check_alarm():
    """ESP32 polls this endpoint to check for new alarms"""
    with state_lock:
        if CURRENT_PANIC["active"] and not CURRENT_PANIC["acknowledged"]:
            # Format response for ESP32
            response = {
                "active": True,
                "resident": {
                    "name": CURRENT_PANIC["resident_name"],
                    "flat": CURRENT_PANIC["address"],  # Using address as flat
                    "phone": CURRENT_PANIC["phone"]
                },
                "panicId": CURRENT_PANIC["panicId"]
            }
            print(f"📱 Sending panic to ESP32: {CURRENT_PANIC['panicId']}")
            return jsonify(response), 200
        
        return jsonify({"active": False}), 200
@app.route("/acknowledge", methods=["POST"])
def acknowledge():
    """ESP32 acknowledges receiving and handling the panic"""
    data = request.get_json()
    panic_id = data.get("panicId") if data else None
    
    with state_lock:
        if not CURRENT_PANIC["active"]:
            return jsonify({"error": "No active panic"}), 400
            
        if panic_id and panic_id != CURRENT_PANIC["panicId"]:
            return jsonify({"error": "Panic ID mismatch"}), 400
        
        # Check if already acknowledged (by timeout)
        if CURRENT_PANIC.get("acknowledged") and CURRENT_PANIC.get("acknowledged_by") == "timeout":
            print(f"⚠️ Ignoring manual ACK - already auto-acknowledged: {CURRENT_PANIC['panicId']}")
            return jsonify({"warning": "Panic already auto-acknowledged", "success": True}), 200
        
        # Mark as acknowledged locally
        CURRENT_PANIC["acknowledged"] = True
        CURRENT_PANIC["acknowledged_by"] = "device"
        print(f"✅ LOCAL ACK: {CURRENT_PANIC['panicId']}")
        
        # Try to acknowledge with production API (in background)
        def sync_ack_to_production():
            try:
                ack_response = requests.post(
                    f"{PRODUCTION_BASE_URL}/api/device/panic/ack",
                    json={
                        "panicId": CURRENT_PANIC["panicId"],
                        "deviceId": DEVICE_ID
                    },
                    timeout=5
                )
                
                if ack_response.status_code == 200:
                    print(f"✅ ACK SYNCED TO PRODUCTION: {CURRENT_PANIC['panicId']}")
                else:
                    print(f"⚠️ Failed to sync ack: {ack_response.status_code}")
                    
            except Exception as e:
                print(f"❌ Failed to sync acknowledgment: {str(e)}")
        
        # Run sync in background thread
        sync_thread = threading.Thread(target=sync_ack_to_production, daemon=True)
        sync_thread.start()
        
        return jsonify({"success": True, "message": "Panic acknowledged"}), 200

@app.route("/status", methods=["GET"])
def get_status():
    """Debug endpoint to check current state"""
    with state_lock:
        return jsonify({
            "device_id": DEVICE_ID,
            "current_panic": CURRENT_PANIC,
            "production_api": PRODUCTION_BASE_URL
        }), 200

@app.route("/test-panic", methods=["POST"])
def test_panic():
    """Test endpoint to simulate a panic (for debugging)"""
    test_data = {
        "uid": "test-user-123",
        "residentName": "Test Resident",
        "address": "Flat 101, Test Building",
        "phoneNumber": "+1234567890",
        "estateId": "test-estate",
        "deviceId": DEVICE_ID
    }
    
    try:
        response = requests.post(
            f"{PRODUCTION_BASE_URL}/api/panic",
            json=test_data,
            timeout=10
        )
        return jsonify(response.json()), response.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    print(f"🚀 Middleware starting for device: {DEVICE_ID}")
    print(f"🔗 Connecting to: {PRODUCTION_BASE_URL}")
    print("📡 Polling production API every 3 seconds")
    app.run(host="0.0.0.0", port=5005, debug=True)