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
// });import express from "express";
import { v4 as uuid } from "uuid";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const panicEvents = new Map();

// Auto-acknowledge timeout: 30 seconds
const AUTO_ACK_TIMEOUT = 30 * 1000;
// Cleanup old panics: 5 minutes
const CLEANUP_AGE = 5 * 60 * 1000;

// CREATE PANIC
app.post("/api/panic", (req, res) => {
  const { deviceId, residentId, residentName, apartment, location } = req.body;

  if (!deviceId || !residentName || !apartment) {
    return res.status(400).json({
      error: "deviceId, residentName, apartment are required"
    });
  }

  const panicId = uuid();
  const now = new Date().toISOString();

  panicEvents.set(panicId, {
    panicId,
    deviceId,
    residentId: residentId || null,
    residentName,
    apartment,
    location: location || null,
    status: "pending",
    createdAt: now,
    deliveredAt: null,
    acknowledgedAt: null,
    autoAckTimer: null
  });

  console.log(`🚨 NEW PANIC: ${residentName} (${apartment}) - ${panicId}`);
  res.status(201).json({ success: true, panicId });
});

// DEVICE POLL
app.get("/api/device/panic", (req, res) => {
  const { deviceId } = req.query;
  
  if (!deviceId) {
    return res.status(400).json({ error: "deviceId is required" });
  }

  cleanupOldPanics();

  const panic = [...panicEvents.values()]
    .filter(p => p.deviceId === deviceId && (p.status === "pending" || p.status === "delivered"))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];

  if (!panic) {
    return res.json({ panic: false });
  }

  if (panic.status === "pending") {
    panic.status = "delivered";
    panic.deliveredAt = new Date().toISOString();
    console.log(`📤 DELIVERED: ${panic.panicId} to ${deviceId}`);
    startAutoAckTimer(panic);
  }

  res.json({
    panic: true,
    event: {
      panicId: panic.panicId,
      residentName: panic.residentName,
      apartment: panic.apartment,
      location: panic.location,
      createdAt: panic.createdAt
    }
  });
});

// ACK PANIC
app.post("/api/device/panic/ack", (req, res) => {
  const { panicId, deviceId } = req.body;

  if (!panicId || !deviceId) {
    return res.status(400).json({ error: "panicId and deviceId are required" });
  }

  const panic = panicEvents.get(panicId);

  if (!panic) {
    return res.status(404).json({ error: "panic not found" });
  }

  if (panic.deviceId !== deviceId) {
    return res.status(403).json({ error: "device mismatch" });
  }

  if (panic.autoAckTimer) {
    clearTimeout(panic.autoAckTimer);
    panic.autoAckTimer = null;
  }

  panic.status = "acknowledged";
  panic.acknowledgedAt = new Date().toISOString();

  console.log(`✅ ACKNOWLEDGED: ${panicId} by ${deviceId}`);
  res.json({ success: true });
});

// LIST ALL PANICS
app.get("/api/panic/list", (req, res) => {
  const panics = [...panicEvents.values()].map(p => ({
    panicId: p.panicId,
    residentName: p.residentName,
    apartment: p.apartment,
    status: p.status,
    createdAt: p.createdAt,
    deliveredAt: p.deliveredAt,
    acknowledgedAt: p.acknowledgedAt
  }));

  res.json({ total: panics.length, panics });
});

// DELETE PANIC
app.delete("/api/panic/:panicId", (req, res) => {
  const { panicId } = req.params;
  const panic = panicEvents.get(panicId);
  
  if (panic && panic.autoAckTimer) {
    clearTimeout(panic.autoAckTimer);
  }
  
  if (panicEvents.delete(panicId)) {
    console.log(`🗑️  DELETED: ${panicId}`);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "panic not found" });
  }
});

// HEALTH CHECK
app.get("/health", (_, res) => {
  res.json({ 
    status: "ok",
    totalPanics: panicEvents.size,
    uptime: process.uptime()
  });
});

// Start auto-acknowledge timer
function startAutoAckTimer(panic) {
  if (panic.autoAckTimer) {
    clearTimeout(panic.autoAckTimer);
  }

  panic.autoAckTimer = setTimeout(() => {
    if (panic.status === "delivered") {
      panic.status = "acknowledged";
      panic.acknowledgedAt = new Date().toISOString();
      console.log(`⏰ AUTO-ACKNOWLEDGED: ${panic.panicId} (30s timeout)`);
    }
  }, AUTO_ACK_TIMEOUT);
}

// Clean up old panics
function cleanupOldPanics() {
  const now = Date.now();
  
  for (const [id, panic] of panicEvents) {
    const age = now - new Date(panic.createdAt).getTime();
    if (age > CLEANUP_AGE) {
      if (panic.autoAckTimer) {
        clearTimeout(panic.autoAckTimer);
      }
      panicEvents.delete(id);
      console.log(`🧹 CLEANED UP: ${id} (${Math.round(age / 60000)} minutes old)`);
    }
  }
}

setInterval(cleanupOldPanics, 60 * 1000);

app.listen(PORT, () => {
  console.log(`🚨 Panic API running on port ${PORT}`);
  console.log(`⏰ Auto-acknowledge timeout: 30 seconds`);
  console.log(`🧹 Cleanup age: 5 minutes`);
});