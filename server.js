import express from "express";
import { v4 as uuid } from "uuid";
import admin from "firebase-admin";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const serviceAccount = require("/etc/secrets/serviceAccountKey.json");


const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const panicEvents = new Map();

// Cleanup old panics: 5 minutes
const CLEANUP_AGE = 5 * 60 * 1000;

// Helper function to update Firestore
async function updateFirestorePanic(panicId, updateData) {
  try {
    await db.collection('panics').doc(panicId).update(updateData);
    console.log(`📝 Updated Firestore for panic ${panicId}`);
  } catch (error) {
    console.error('❌ Error updating Firestore:', error);
  }
}

// CREATE PANIC - Updated to match your Flutter model
app.post("/api/panic", async (req, res) => {
  const {
    uid,
    residentName,
    address,
    phoneNumber,
    estateId,
    deviceId // This is important for the hardware
  } = req.body;

  if (!uid) {
    return res.status(400).json({
      error: "uid is required"
    });
  }
  if (!residentName) {
    return res.status(400).json({
      error: "residentName is required"
    });
  }
  if (!address) {
    return res.status(400).json({
      error: "address is required"
    });
  }
  if (!deviceId) {
    return res.status(400).json({
      error: "deviceId is required"
    });
  }
  if (!phoneNumber) {
    return res.status(400).json({
      error: "phoneNumber is required"
    });
  }
  if (!estateId) {
    return res.status(400).json({
      error: "estateId is required"
    });
  }


  // Generate a new panic ID
  const panicId = uuid();
  const serverCreatedAt = new Date().toISOString();

  const panicData = {
    uid,
    createdAt: serverCreatedAt, // Use server time for consistency
    panicId,
    residentName,
    address,
    phoneNumber,
    estateId,
    deviceId,
    status: "pending",
    deliveredAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null // 'device' or 'timeout'
  };

  // Store in memory
  panicEvents.set(panicId, panicData);

  // Save to Firestore
  try {
    await db.collection('panics').doc(panicId).set(panicData);
    console.log(`🚨 NEW PANIC: ${panicId} from ${residentName} (${deviceId}) - Saved to Firestore`);
  } catch (error) {
    console.error('❌ Error saving to Firestore:', error);
  }

  res.status(201).json({
    success: true,
    panicId: panicId,
    message: "Panic created and saved to database"
  });
});

// DEVICE POLL
app.get("/api/device/panic", async (req, res) => {
  const { deviceId } = req.query;

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId is required" });
  }

  cleanupOldPanics();

  // Only find PENDING panics for this device
  const panic = [...panicEvents.values()]
    .filter(p => p.deviceId === deviceId && p.status === "pending")
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];

  if (!panic) {
    return res.json({ panic: false });
  }

  // Mark as delivered
  panic.status = "delivered";
  panic.deliveredAt = new Date().toISOString();

  // Update Firestore
  await updateFirestorePanic(panic.panicId, {
    status: "delivered",
    deliveredAt: panic.deliveredAt
  });

  console.log(`📲 DELIVERED: ${panic.panicId} to ${deviceId}`);

  res.json({
    panic: true,
    event: {
      panicId: panic.panicId,
      residentName: panic.residentName,
      address: panic.address,
      phoneNumber: panic.phoneNumber,
      deviceId: panic.deviceId,
      createdAt: panic.createdAt
    }
  });
});

// ACK PANIC
// ACK PANIC - UPDATED VERSION
app.post("/api/device/panic/ack", async (req, res) => {
  const { panicId, deviceId, acknowledgedBy } = req.body;

  if (!panicId || !deviceId) {
    return res.status(400).json({
      error: "panicId and deviceId are required"
    });
  }

  // acknowledgedBy must be "manual" or "auto" (sent by ESP)
  const ackSource = acknowledgedBy === "auto" ? "auto" : "manual";

  const panic = panicEvents.get(panicId);

  if (!panic) return res.status(404).json({ error: "panic not found" });
  if (panic.deviceId !== deviceId) {
    return res.status(403).json({ error: "device mismatch" });
  }

  // Reject if already acknowledged
  if (panic.status === "acknowledged") {
    console.log(`⚠️ IGNORING DUPLICATE ACK: ${panicId} already acknowledged by ${panic.acknowledgedBy}`);
    return res.status(200).json({
      success: true,
      message: "Panic already acknowledged",
      acknowledgedBy: panic.acknowledgedBy
    });
  }

  // Update panic status
  panic.status = "acknowledged";
  panic.acknowledgedAt = new Date().toISOString();
  panic.acknowledgedBy = ackSource;

  // Update Firestore
  await updateFirestorePanic(panicId, {
    status: "acknowledged",
    acknowledgedAt: panic.acknowledgedAt,
    acknowledgedBy: ackSource
  });

  const ackLabel = ackSource === "auto" ? "AUTO" : "MANUALLY";
  console.log(`✅ ${ackLabel} ACKNOWLEDGED: ${panic.panicId} by ${deviceId}`);
  res.json({ 
    success: true,
    acknowledgedBy: ackSource,
    message: ackSource === "auto"
      ? "Panic auto-acknowledged by device timer"
      : "Panic manually acknowledged by device"
  });
});

// GET SINGLE PANIC DETAILS
app.get("/api/panic/:panicId", async (req, res) => {
  const { panicId } = req.params;

  try {
    const doc = await db.collection('panics').doc(panicId).get();

    if (!doc.exists) {
      return res.status(404).json({ error: "panic not found" });
    }

    res.json(doc.data());
  } catch (error) {
    console.error('Error fetching panic:', error);
    res.status(500).json({ error: "Failed to fetch panic" });
  }
});

// DELETE PANIC (from memory only, Firestore keeps history)
app.delete("/api/panic/:panicId", (req, res) => {
  const { panicId } = req.params;
  
  if (panicEvents.delete(panicId)) {
    console.log(`🗑️  DELETED from memory: ${panicId}`);
    res.json({
      success: true,
      message: "Panic removed from memory (still in Firestore for records)"
    });
  } else {
    res.status(404).json({ error: "panic not found in memory" });
  }
});

// Clean up old panics (from memory only)
function cleanupOldPanics() {
  const now = Date.now();

  for (const [id, panic] of panicEvents) {
    const age = now - new Date(panic.createdAt).getTime();
    if (age > CLEANUP_AGE) {
      panicEvents.delete(id);
      console.log(`🧹 CLEANED UP from memory: ${id} (${Math.round(age / 60000)} minutes old)`);
    }
  }
}

setInterval(cleanupOldPanics, 60 * 1000);

// === DEVICE MANAGEMENT ENDPOINTS ===

// Online threshold: 60 seconds
const ONLINE_THRESHOLD = 60 * 1000;

// DEVICE HEARTBEAT - ESP polls this every 30 seconds
app.post("/api/device/heartbeat", async (req, res) => {
  const { deviceId, batteryLevel } = req.body;

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId is required" });
  }

  if (batteryLevel === undefined || batteryLevel === null) {
    return res.status(400).json({ error: "batteryLevel is required" });
  }

  try {
    const deviceRef = db.collection('devices').doc(deviceId);
    const deviceDoc = await deviceRef.get();

    if (!deviceDoc.exists) {
      return res.status(404).json({
        error: "Device not registered",
        message: "Please register the device first"
      });
    }

    const now = new Date().toISOString();
    await deviceRef.update({
      batteryLevel,
      lastSeen: now
    });

    const deviceData = deviceDoc.data();
    console.log(`💓 HEARTBEAT: ${deviceId} - Battery: ${batteryLevel}%`);

    res.json({
      success: true,
      enabled: deviceData.enabled !== false, // Default to true if not set
      message: "Heartbeat received"
    });
  } catch (error) {
    console.error('❌ Error updating device heartbeat:', error);
    res.status(500).json({ error: "Failed to update heartbeat" });
  }
});

// HEALTH CHECK
app.get("/health", async (_, res) => {
  try {
    // Test Firestore connection
    await db.collection('health').doc('test').set({
      test: true,
      timestamp: new Date().toISOString()
    }, { merge: true });

    res.json({
      status: "ok",
      firestore: "connected",
      totalPanicsInMemory: panicEvents.size,
      uptime: process.uptime()
    });
  } catch (error) {
    console.error('Firestore health check failed:', error);
    res.status(500).json({
      status: "error",
      firestore: "disconnected",
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚨 Panic API running on port ${PORT}`);
  console.log(`🔥 Firebase Admin initialized`);
  console.log(`🧹 Cleanup age: 5 minutes (memory only)`);
});