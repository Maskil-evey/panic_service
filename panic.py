# import requests
# from flask import Flask, jsonify, request
# from flask_cors import CORS
# from datetime import datetime
# import time
# import threading

# app = Flask(__name__)
# CORS(app)

# # --- CONFIGURATION ---
# DEVICE_ID = "panic-device-01"
# RENDER_BASE_URL = "https://panic-service.onrender.com/api/device/panic"
# POLL_INTERVAL = 2  # Poll every 2 seconds

# # --- Local State ---
# LATEST_ALERT = {
#     "active": False,
#     "panicId": None,
#     "resident_name": None,
#     "flat_number": None,
#     "last_updated": None
# }

# # Thread-safe lock for state updates
# state_lock = threading.Lock()

# def poll_main_backend():
#     """Ask Render for the oldest pending panic for this device"""
#     try:
#         response = requests.get(
#             RENDER_BASE_URL, 
#             params={"deviceId": DEVICE_ID}, 
#             timeout=10
#         )
#         data = response.json()

#         with state_lock:
#             if data.get("panic") == True:
#                 event = data.get("event", {})
#                 new_panic_id = event.get("panicId")
                
#                 # Check if this is a different panic than what we're currently showing
#                 is_new_panic = new_panic_id != LATEST_ALERT["panicId"]
                
#                 if is_new_panic:
#                     # New panic detected!
#                     LATEST_ALERT.update({
#                         "active": True,
#                         "panicId": new_panic_id,
#                         "resident_name": event.get("residentName"),
#                         "flat_number": event.get("apartment"),
#                         "last_updated": datetime.now().isoformat()
#                     })
#                     print(f"🚨 NEW ALARM: {LATEST_ALERT['resident_name']} in {LATEST_ALERT['flat_number']} needs help!")
#                 elif not LATEST_ALERT["active"]:
#                     # Same panic, but local state was reset - restore it
#                     LATEST_ALERT.update({
#                         "active": True,
#                         "panicId": new_panic_id,
#                         "resident_name": event.get("residentName"),
#                         "flat_number": event.get("apartment"),
#                         "last_updated": datetime.now().isoformat()
#                     })
#                     print(f"🔄 RESTORING ALARM: {LATEST_ALERT['resident_name']} in {LATEST_ALERT['flat_number']}")
#             else:
#                 # Cloud says no panic - could be auto-acknowledged or manually acknowledged
#                 if LATEST_ALERT["active"]:
#                     print("✅ Panic cleared (auto-ack or manual) - resetting local state")
#                     LATEST_ALERT.update({
#                         "active": False,
#                         "panicId": None,
#                         "resident_name": None,
#                         "flat_number": None,
#                         "last_updated": datetime.now().isoformat()
#                     })

#         return True

#     except requests.exceptions.Timeout:
#         print("⚠️  Timeout connecting to Render (server don dey sleep)")
#         return False
#     except Exception as e:
#         print(f"❌ Error connecting to Render: {e}")
#         return False

# def background_poller():
#     """Background thread that continuously polls the backend"""
#     print("🔄 Starting background poller...")
#     while True:
#         poll_main_backend()
#         time.sleep(POLL_INTERVAL)

# # Start background polling when server starts
# polling_thread = threading.Thread(target=background_poller, daemon=True)
# polling_thread.start()

# @app.route("/check-alarm", methods=["GET"])
# def check_alarm():
#     """ESP32 calls this to see if it should make noise"""
#     with state_lock:
#         return jsonify({
#             "active": LATEST_ALERT["active"],
#             "resident": {
#                 "name": LATEST_ALERT["resident_name"],
#                 "flat": LATEST_ALERT["flat_number"]
#             },
#             "last_updated": LATEST_ALERT["last_updated"]
#         }), 200

# @app.route("/acknowledge", methods=["POST"])
# def acknowledge():
#     """
#     Triggered by ESP32 physical button.
#     This sends the acknowledgment BACK to the Render server.
#     """
#     with state_lock:
#         current_panic_id = LATEST_ALERT["panicId"]
        
#     if not current_panic_id:
#         return jsonify({"error": "No active panic to acknowledge"}), 400

#     try:
#         ack_url = f"{RENDER_BASE_URL}/ack"
#         payload = {
#             "panicId": current_panic_id,
#             "deviceId": DEVICE_ID
#         }

#         print(f"📤 Sending ACK for panic {current_panic_id} to Render...")
#         response = requests.post(ack_url, json=payload, timeout=10)

#         if response.status_code == 200:
#             print("✅ Successfully acknowledged on cloud")
            
#             # Reset local state
#             with state_lock:
#                 LATEST_ALERT.update({
#                     "active": False,
#                     "panicId": None,
#                     "resident_name": None,
#                     "flat_number": None,
#                     "last_updated": datetime.now().isoformat()
#                 })
            
#             return jsonify({"success": True, "message": "Panic acknowledged"}), 200
#         else:
#             print(f"❌ Cloud rejected ACK: {response.text}")
#             return jsonify({"error": "Cloud rejected acknowledgment"}), response.status_code

#     except requests.exceptions.Timeout:
#         print("⚠️  Timeout during ACK - cloud might be sleeping")
#         return jsonify({"error": "Network timeout"}), 504
#     except Exception as e:
#         print(f"❌ Connection error during ACK: {e}")
#         return jsonify({"error": "Network failure"}), 500

# @app.route("/status", methods=["GET"])
# def status():
#     """Check middleware status and current alert state"""
#     with state_lock:
#         return jsonify({
#             "middleware": "running",
#             "device_id": DEVICE_ID,
#             "current_alert": LATEST_ALERT,
#             "poll_interval_seconds": POLL_INTERVAL
#         }), 200

# @app.route("/force-poll", methods=["POST"])
# def force_poll():
#     """Manually trigger a poll (useful for testing)"""
#     success = poll_main_backend()
#     return jsonify({
#         "success": success,
#         "current_state": LATEST_ALERT
#     }), 200 if success else 500

# if __name__ == "__main__":
#     print(f"🚨 Panic Middleware starting...")
#     print(f"📡 Device ID: {DEVICE_ID}")
#     print(f"🌐 Backend: {RENDER_BASE_URL}")
#     print(f"🔄 Poll interval: {POLL_INTERVAL} seconds")
#     app.run(host="0.0.0.0", port=5005)


import requests
from flask import Flask, jsonify, request
from flask_cors import CORS
from datetime import datetime
import time
import threading

app = Flask(__name__)
CORS(app)

# --- CONFIGURATION ---
DEVICE_ID = "panic-device-01"
RENDER_BASE_URL = "https://panic-service.onrender.com/api/device/panic"
POLL_INTERVAL = 2  # Poll every 2 seconds

# --- Local State ---
LATEST_ALERT = {
    "active": False,
    "panicId": None,
    "resident_name": None,
    "flat_number": None,
    "street": None,
    "last_updated": None,
    "sent_to_device": False
}


state_lock = threading.Lock()

def poll_main_backend():
    """Poll Render for pending panic"""
    try:
        response = requests.get(RENDER_BASE_URL, params={"deviceId": DEVICE_ID}, timeout=10)
        data = response.json()

        with state_lock:
           if data.get("panic") is True:
            event = data.get("event", {})
            new_panic_id = event.get("panicId")

            is_new_panic = new_panic_id != LATEST_ALERT["panicId"]

            if is_new_panic:
                LATEST_ALERT.update({
                    "active": True,
                    "panicId": new_panic_id,
                    "resident_name": event.get("residentName"),
                    "flat_number": event.get("residentHouseNumber"),
                    "street": event.get("residentStreet"),
                    "last_updated": event.get("createdAt"),
                    "sent_to_device": False
                })

                print(
                    f"🚨 NEW PANIC: {event.get('residentName')} | "
                    f"{event.get('residentHouseNumber')} {event.get('residentStreet')}"
                )


            else:
                # No active panic
                if LATEST_ALERT["active"]:
                    print("✅ Panic cleared - resetting local state")
                    LATEST_ALERT.update({
                        "active": False,
                        "panicId": None,
                        "resident_name": None,
                        "flat_number": None,
                        "last_updated": datetime.now().isoformat(),
                        "sent_to_device": False
                    })

        return True
    except Exception as e:
        print(f"❌ Error connecting to Render: {e}")
        return False

def background_poller():
    """Continuously poll backend in background"""
    print("🔄 Starting background poller...")
    while True:
        poll_main_backend()
        time.sleep(POLL_INTERVAL)

# Start poller thread
threading.Thread(target=background_poller, daemon=True).start()

# --- ROUTES ---

@app.route("/check-alarm", methods=["GET"])
def check_alarm():
    with state_lock:
        if LATEST_ALERT["active"] and not LATEST_ALERT["sent_to_device"]:
            LATEST_ALERT["sent_to_device"] = True

            response_data = {
                "active": True,
                "panic": {
                    "panicId": LATEST_ALERT["panicId"],
                    "residentName": LATEST_ALERT["resident_name"],
                    "residentHouseNumber": LATEST_ALERT["flat_number"],
                    "residentStreet": LATEST_ALERT["street"],
                    "lastUpdated": LATEST_ALERT["last_updated"]
                }
            }

            print(f"📤 Sending alarm to device → {response_data}")
            return jsonify(response_data), 200

        return jsonify({"active": False}), 200


@app.route("/acknowledge", methods=["POST"])
def acknowledge():
    with state_lock:
        current_panic_id = LATEST_ALERT["panicId"]

    if not current_panic_id:
        return jsonify({"error": "No active panic to acknowledge"}), 400

    try:
        ack_url = f"{RENDER_BASE_URL.replace('/panic', '/panic/ack')}"
        payload = {"panicId": current_panic_id, "deviceId": DEVICE_ID}

        print(f"📤 Sending ACK for panic {current_panic_id} to Render...")
        response = requests.post(ack_url, json=payload, timeout=10)

        if response.status_code == 200:
            print("✅ Successfully acknowledged on cloud")
            # Reset local state
            with state_lock:
                LATEST_ALERT.update({
                    "active": False,
                    "panicId": None,
                    "resident_name": None,
                    "flat_number": None,
                    "last_updated": datetime.now().isoformat(),
                    "sent_to_device": False
                })
            return jsonify({"success": True, "message": "Panic acknowledged"}), 200
        else:
            print(f"❌ Cloud rejected ACK: {response.text}")
            return jsonify({"error": "Cloud rejected acknowledgment"}), response.status_code

    except Exception as e:
        print(f"❌ Connection error during ACK: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    print(f"🚨 Panic Middleware starting...")
    print(f"📡 Device ID: {DEVICE_ID}")
    print(f"🌐 Backend: {RENDER_BASE_URL}")
    print(f"🔄 Poll interval: {POLL_INTERVAL} seconds")
    app.run(host="0.0.0.0", port=5005)
