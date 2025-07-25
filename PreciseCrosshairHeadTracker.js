// === INSTANT HEAD TRACKER - ZERO DELAY ===

class FastVector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone() {
    return new FastVector3(this.x, this.y, this.z);
  }
}

class InstantHeadTracker {
  constructor() {
    this.worldPos = new FastVector3();
    this.headPosition = new FastVector3();

    this.modelMatrix = new Float32Array(16);
    this.bindMatrix = new Float32Array(16);

    this.isRunning = false;
    this.frameId = null;

    this.lastAimTime = 0;
    this.minAimInterval = 0;

    console.log("⚡ INSTANT TRACKER - ZERO DELAY MODE");
  }

  precomputeBindMatrix(bindpose) {
    const b = this.bindMatrix;
    b[0] = bindpose.e00; b[1] = bindpose.e01; b[2] = bindpose.e02; b[3] = bindpose.e03;
    b[4] = bindpose.e10; b[5] = bindpose.e11; b[6] = bindpose.e12; b[7] = bindpose.e13;
    b[8] = bindpose.e20; b[9] = bindpose.e21; b[10] = bindpose.e22; b[11] = bindpose.e23;
    b[12] = bindpose.e30; b[13] = bindpose.e31; b[14] = bindpose.e32; b[15] = bindpose.e33;
  }

  fastQuatToMatrix(q) {
    const { x, y, z, w } = q;
    const m = this.modelMatrix;

    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;

    m[0] = 1 - (yy + zz); m[1] = xy - wz; m[2] = xz + wy; m[3] = 0;
    m[4] = xy + wz; m[5] = 1 - (xx + zz); m[6] = yz - wx; m[7] = 0;
    m[8] = xz - wy; m[9] = yz + wx; m[10] = 1 - (xx + yy); m[11] = 0;
    m[12] = 0; m[13] = 0; m[14] = 0; m[15] = 1;

    return m;
  }

  getInstantHeadPos(position, rotation, scale) {
    const m = this.fastQuatToMatrix(rotation);
    const b = this.bindMatrix;

    const px = position.x, py = position.y, pz = position.z;
    const sx = scale.x, sy = scale.y, sz = scale.z;

    const tx = m[0] * sx * px + m[1] * sy * py + m[2] * sz * pz + px;
    const ty = m[4] * sx * px + m[5] * sy * py + m[6] * sz * pz + py;
    const tz = m[8] * sx * px + m[9] * sy * py + m[10] * sz * pz + pz;

    this.worldPos.x = b[0] * tx + b[1] * ty + b[2] * tz + b[3];
    this.worldPos.y = b[4] * tx + b[5] * ty + b[6] * tz + b[7];
    this.worldPos.z = b[8] * tx + b[9] * ty + b[10] * tz + b[11];

    return this.worldPos;
  }

  instantAim(vec3) {
    try {
      if (typeof GameAPI !== "undefined") {
        GameAPI.setCrosshairTarget?.(vec3.x, vec3.y, vec3.z);
        GameAPI.setAimTarget?.(vec3.x, vec3.y, vec3.z);
        GameAPI.lockTarget?.(vec3.x, vec3.y, vec3.z);
      }

      if (typeof window !== "undefined" && window.GameAPI) {
        window.GameAPI.setCrosshairTarget?.(vec3.x, vec3.y, vec3.z);
        window.GameAPI.setAimTarget?.(vec3.x, vec3.y, vec3.z);
      }

      setCrosshairTarget?.(vec3.x, vec3.y, vec3.z);
      setAimTarget?.(vec3.x, vec3.y, vec3.z);
    } catch (e) {
      // Silent fail
    }
  }

  fastCrosshairCheck() {
    try {
      return (
        (typeof GameAPI !== "undefined" &&
          (GameAPI.crosshairState === "red" ||
            GameAPI.targetLocked === true ||
            GameAPI.enemyDetected === true)) ||
        (typeof window !== "undefined" && window.GameAPI &&
          (window.GameAPI.crosshairState === "red" ||
            window.GameAPI.targetLocked === true)) ||
        (typeof crosshairRed === "boolean" && crosshairRed) ||
        (typeof targetLocked === "boolean" && targetLocked)
      );
    } catch (e) {
      return true;
    }
  }

  instantTrack(position, rotation, scale) {
    if (!this.isRunning) return;

    const headPos = this.getInstantHeadPos(position, rotation, scale);
    this.headPosition.copy(headPos);

    if (this.fastCrosshairCheck()) {
      this.instantAim(headPos);
    }

    this.frameId = setTimeout(() => 
  this.instantTrack(position, rotation, scale), 
  0
);
  }

  start(position, rotation, scale, bindpose) {
    if (this.isRunning) this.stop();

    this.precomputeBindMatrix(bindpose);
    this.isRunning = true;

    console.log("⚡ INSTANT TRACKING STARTED - ZERO DELAY");
    this.instantTrack(position, rotation, scale);
  }

  stop() {
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.isRunning = false;
    console.log("⏹️ Instant tracker stopped");
  }

  startHighFreq(position, rotation, scale, bindpose) {
    if (this.isRunning) this.stop();

    this.precomputeBindMatrix(bindpose);
    this.isRunning = true;

    console.log("🚀 HIGH FREQUENCY MODE - 240 FPS");

    const runFrame = () => {
      if (!this.isRunning) return;

      const headPos = this.getInstantHeadPos(position, rotation, scale);
      this.headPosition.copy(headPos);

      if (this.fastCrosshairCheck()) {
        this.instantAim(headPos);
      }

      setTimeout(runFrame, 4);
    };

    runFrame();
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      mode: "INSTANT",
      delay: "ZERO",
      headPos: this.headPosition
    };
  }
}

// === Bone Data ===
const bone_Head = {
  position: { x: -0.0456970781, y: -0.004478302, z: -0.0200432576 },
  rotation: { x: 0.0258174837, y: -0.08611039, z: -0.1402113, w: 0.9860321 },
  scale: { x: 0.99999994, y: 1.00000012, z: 1.0 },
  bindpose: {
    e00: -1.34559613e-13, e01: 8.881784e-14, e02: -1.0, e03: 0.487912,
    e10: -2.84512817e-6, e11: -1.0, e12: 8.881784e-14, e13: -2.842171e-14,
    e20: -1.0, e21: 2.84512817e-6, e22: -1.72951931e-13, e23: 0.0,
    e30: 0.0, e31: 0.0, e32: 0.0, e33: 1.0
  }
};

// === Initialize ===
const instantTracker = new InstantHeadTracker();
instantTracker.start(
  bone_Head.position,
  bone_Head.rotation,
  bone_Head.scale,
  bone_Head.bindpose
);

// === Controls ===
window.stopInstant = () => instantTracker.stop();
window.startInstant = () => instantTracker.start(
  bone_Head.position,
  bone_Head.rotation,
  bone_Head.scale,
  bone_Head.bindpose
);
window.startHighFreq = () => instantTracker.startHighFreq(
  bone_Head.position,
  bone_Head.rotation,
  bone_Head.scale,
  bone_Head.bindpose
);
window.getInstantStatus = () => instantTracker.getStatus();

// === Super Aggressive ===
window.superAggressive = () => {
  console.log("💀 SUPER AGGRESSIVE MODE ACTIVATED");

  const superTracker = new InstantHeadTracker();
  superTracker.fastCrosshairCheck = () => true;
  superTracker.minAimInterval = 0;

  superTracker.start(
    bone_Head.position,
    bone_Head.rotation,
    bone_Head.scale,
    bone_Head.bindpose
  );

  window.currentTracker = superTracker;
  return superTracker;
};

// === Max Performance ===
window.maxPerformance = () => {
  console.log("🔥 MAXIMUM PERFORMANCE MODE");
  console.log = () => {};
  console.warn = () => {};

  const maxTracker = new InstantHeadTracker();
  maxTracker.instantAim = (vec3) => {
    GameAPI?.setCrosshairTarget?.(vec3.x, vec3.y, vec3.z);
    window.GameAPI?.setCrosshairTarget?.(vec3.x, vec3.y, vec3.z);
    setCrosshairTarget?.(vec3.x, vec3.y, vec3.z);
  };

  maxTracker.startHighFreq(
    bone_Head.position,
    bone_Head.rotation,
    bone_Head.scale,
    bone_Head.bindpose
  );

  return maxTracker;
};

console.log("⚡ INSTANT HEAD TRACKER ACTIVE!");
console.log("🎮 Commands:");
console.log("  stopInstant() - Stop tracking");
console.log("  startInstant() - Start normal instant mode");
console.log("  startHighFreq() - Start 240 FPS mode");
console.log("  superAggressive() - Always aim mode");
console.log("  maxPerformance() - Ultimate speed mode");
console.log("  getInstantStatus() - Check status");
console.log("🚀 TRACKING STARTED - ZERO DELAY, MAXIMUM SPEED!");
