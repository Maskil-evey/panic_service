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

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const panicEvents = new Map();

/**
 * CREATE PANIC
 */
app.post("/api/panic", (req, res) => {
  const {
    deviceId,
    residentId,
    residentName,
    apartment,
    location
  } = req.body;

  if (!deviceId || !residentName || !apartment) {
    return res.status(400).json({
      error: "deviceId, residentName, apartment are required"
    });
  }

  const panicId = uuid();

  panicEvents.set(panicId, {
    panicId,
    deviceId,
    residentId: residentId || null,
    residentName,
    apartment,
    location: location || null,
    status: "pending",
    createdAt: new Date().toISOString(),
    deliveredAt: null,
    acknowledgedAt: null
  });

  console.log(`🚨 NEW PANIC: ${residentName} (${apartment}) - ${panicId}`);

  res.status(201).json({ success: true, panicId });
});

/**
 * DEVICE POLL - Returns the oldest pending panic for this device
 */
app.get("/api/device/panic", (req, res) => {
  const { deviceId } = req.query;
  
  if (!deviceId) {
    return res.status(400).json({ error: "deviceId is required" });
  }

  // Clean up old panics (older than 10 minutes)
  cleanupOldPanics();

  // Find the oldest pending OR delivered panic (not acknowledged)
  const panic = [...panicEvents.values()]
    .filter(p => 
      p.deviceId === deviceId && 
      (p.status === "pending" || p.status === "delivered")
    )
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0];

  if (!panic) {
    return res.json({ panic: false });
  }

  // Only update to delivered if it was pending
  if (panic.status === "pending") {
    panic.status = "delivered";
    panic.deliveredAt = new Date().toISOString();
    console.log(`📤 DELIVERED: ${panic.panicId} to ${deviceId}`);
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

/**
 * ACK PANIC - Device acknowledges the panic
 */
app.post("/api/device/panic/ack", (req, res) => {
  const { panicId, deviceId } = req.body;

  if (!panicId || !deviceId) {
    return res.status(400).json({
      error: "panicId and deviceId are required"
    });
  }

  const panic = panicEvents.get(panicId);

  if (!panic) {
    return res.status(404).json({ error: "panic not found" });
  }

  if (panic.deviceId !== deviceId) {
    return res.status(403).json({ error: "device mismatch" });
  }

  panic.status = "acknowledged";
  panic.acknowledgedAt = new Date().toISOString();

  console.log(`✅ ACKNOWLEDGED: ${panicId} by ${deviceId}`);

  res.json({ success: true });
});

/**
 * LIST ALL PANICS (for debugging/monitoring)
 */
app.get("/api/panic/list", (req, res) => {
  const panics = [...panicEvents.values()].map(p => ({
    panicId: p.panicId,
    residentName: p.residentName,
    apartment: p.apartment,
    status: p.status,
    createdAt: p.createdAt,
    acknowledgedAt: p.acknowledgedAt
  }));

  res.json({ 
    total: panics.length,
    panics 
  });
});

/**
 * DELETE OLD PANIC (for testing)
 */
app.delete("/api/panic/:panicId", (req, res) => {
  const { panicId } = req.params;
  
  if (panicEvents.delete(panicId)) {
    console.log(`🗑️  DELETED: ${panicId}`);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "panic not found" });
  }
});

/**
 * HEALTH CHECK
 */
app.get("/health", (_, res) => {
  res.json({ 
    status: "ok",
    totalPanics: panicEvents.size,
    uptime: process.uptime()
  });
});

/**
 * Helper: Clean up old panics
 */
function cleanupOldPanics() {
  const now = Date.now();
  const TEN_MINUTES = 10 * 60 * 1000;
  
  for (const [id, panic] of panicEvents) {
    const age = now - new Date(panic.createdAt).getTime();
    if (age > TEN_MINUTES) {
      panicEvents.delete(id);
      console.log(`🧹 CLEANED UP: ${id} (${Math.round(age / 60000)} minutes old)`);
    }
  }
}

// Periodic cleanup every 2 minutes
setInterval(cleanupOldPanics, 2 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`🚨 Panic API running on port ${PORT}`);
});