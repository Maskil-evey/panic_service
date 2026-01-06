// import express from "express";
// import { v4 as uuid } from "uuid";

// const app = express();
// const PORT = process.env.PORT || 3000;

// app.use(express.json());

// const panicEvents = new Map();

// /**
//  * CREATE PANIC
//  */
// app.post("/api/panic", (req, res) => {
//   const {
//     deviceId,
//     residentId,
//     residentName,
//     apartment,
//     location
//   } = req.body;

//   if (!deviceId || !residentName || !apartment) {
//     return res.status(400).json({
//       error: "deviceId, residentName, apartment are required"
//     });
//   }

//   const panicId = uuid();

//   panicEvents.set(panicId, {
//     panicId,
//     deviceId,
//     residentId: residentId || null,
//     residentName,
//     apartment,
//     location: location || null,
//     status: "pending",
//     createdAt: new Date().toISOString()
//   });

//   res.status(201).json({ success: true, panicId });
// });

// /**
//  * DEVICE POLL
//  */
// app.get("/api/device/panic", (req, res) => {
//   const { deviceId } = req.query;
//   if (!deviceId) return res.status(400).json({ error: "deviceId is required" });

//   // Clean up old panics first
//   const now = Date.now();
//   for (const [id, panic] of panicEvents) {
//     if (now - new Date(panic.createdAt).getTime() > 10 * 60 * 1000) {
//       panicEvents.delete(id);
//     }
//   }

//   // Find the oldest pending panic
//   const panic = [...panicEvents.values()]
//     .filter(p => p.deviceId === deviceId && p.status === "pending")
//     .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];

//   if (!panic) return res.json({ panic: false });

//   panic.status = "delivered";

//   res.json({
//     panic: true,
//     event: {
//       panicId: panic.panicId,
//       residentName: panic.residentName,
//       apartment: panic.apartment,
//       location: panic.location,
//       createdAt: panic.createdAt
//     }
//   });
// });


// /**
//  * ACK PANIC
//  */
// app.post("/api/device/panic/ack", (req, res) => {
//   const { panicId, deviceId } = req.body;

//   if (!panicId || !deviceId) {
//     return res.status(400).json({
//       error: "panicId and deviceId are required"
//     });
//   }

//   const panic = panicEvents.get(panicId);

//   if (!panic) {
//     return res.status(404).json({ error: "panic not found" });
//   }

//   if (panic.deviceId !== deviceId) {
//     return res.status(403).json({ error: "device mismatch" });
//   }

//   panic.status = "acknowledged";
//   panic.acknowledgedAt = new Date().toISOString();

//   res.json({ success: true });
// });

// /**
//  * HEALTH
//  */
// app.get("/health", (_, res) => {
//   res.json({ status: "ok" });
// });

// app.listen(PORT, () => {
//   console.log(`🚨 Panic API running on port ${PORT}`);
// });
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

// Auto-acknowledge timeout: 30 seconds
const AUTO_ACK_TIMEOUT = 30 * 1000;
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

  if (!uid ) {
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
    acknowledgedBy: null, // 'device' or 'timeout'
    autoAckTimer: null
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

  // Mark as delivered and start timer
  panic.status = "delivered";
  panic.deliveredAt = new Date().toISOString();
  
  // Update Firestore
  await updateFirestorePanic(panic.panicId, {
    status: "delivered",
    deliveredAt: panic.deliveredAt
  });
  
  console.log(`📲 DELIVERED: ${panic.panicId} to ${deviceId}`);
  startAutoAckTimer(panic);

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
app.post("/api/device/panic/ack", async (req, res) => {
  const { panicId, deviceId } = req.body;

  if (!panicId || !deviceId) {
    return res.status(400).json({
      error: "panicId and deviceId are required"
    });
  }

  const panic = panicEvents.get(panicId);

  if (!panic) return res.status(404).json({ error: "panic not found" });
  if (panic.deviceId !== deviceId) {
    return res.status(403).json({ error: "device mismatch" });
  }

  // Clear auto-ack timer if exists
  if (panic.autoAckTimer){
    clearTimeout(panic.autoAckTimer);
    panic.autoAckTimer = null;
  }

  // Update panic status
  panic.status = "acknowledged";
  panic.acknowledgedAt = new Date().toISOString();
  panic.acknowledgedBy = "device";

  // Update Firestore
  await updateFirestorePanic(panicId, {
    status: "acknowledged",
    acknowledgedAt: panic.acknowledgedAt,
    acknowledgedBy: "device"
  });

  console.log(`✅ MANUALLY ACKNOWLEDGED: ${panic.panicId} by ${deviceId}`);
  res.json({ 
    success: true,
    acknowledgedBy: "device"
  });
});

// Start auto-acknowledge timer with Firestore update
function startAutoAckTimer(panic) {
  if (panic.autoAckTimer) {
    clearTimeout(panic.autoAckTimer);
  }

  panic.autoAckTimer = setTimeout(async () => {
    // Check if still delivered (not manually acknowledged)
    if (panic.status === "delivered") {
      panic.status = "acknowledged";
      panic.acknowledgedAt = new Date().toISOString();
      panic.acknowledgedBy = "timeout";
      
      // Update Firestore
      await updateFirestorePanic(panic.panicId, {
        status: "acknowledged",
        acknowledgedAt: panic.acknowledgedAt,
        acknowledgedBy: "timeout"
      });
      
      console.log(`⏰ AUTO-ACKNOWLEDGED: ${panic.panicId} (30s timeout)`);
    }
  }, AUTO_ACK_TIMEOUT);
}

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
  const panic = panicEvents.get(panicId);
  
  if (panic && panic.autoAckTimer) {
    clearTimeout(panic.autoAckTimer);
  }
  
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
      if (panic.autoAckTimer) {
        clearTimeout(panic.autoAckTimer);
      }
      panicEvents.delete(id);
      console.log(`🧹 CLEANED UP from memory: ${id} (${Math.round(age / 60000)} minutes old)`);
    }
  }
}

setInterval(cleanupOldPanics, 60 * 1000);

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
  console.log(`⏰ Auto-acknowledge timeout: 30 seconds`);
  console.log(`🧹 Cleanup age: 5 minutes (memory only)`);
});