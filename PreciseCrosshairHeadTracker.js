// == Optimized Vector3 class ==
class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  addMut(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  subtractMut(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  multiplyScalarMut(s) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  lengthSquared() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  normalizeMut() {
    const lenSq = this.lengthSquared();
    if (lenSq > 0) {
      const invLen = 1 / Math.sqrt(lenSq);
      this.x *= invLen;
      this.y *= invLen;
      this.z *= invLen;
    }
    return this;
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
    return new Vector3(this.x, this.y, this.z);
  }

  static zero() {
    return new Vector3(0, 0, 0);
  }
}

// == Optimized Kalman Filter ==
class KalmanFilter {
  constructor(R = 0.01, Q = 0.0001) {
    this.R = R;
    this.Q = Q;
    this.A = 1;
    this.C = 1;
    this.cov = NaN;
    this.x = NaN;
    this.isInitialized = false;
  }

  filter(z) {
    if (!this.isInitialized) {
      this.x = z;
      this.cov = this.R;
      this.isInitialized = true;
    } else {
      const predX = this.x;
      const predCov = this.cov + this.Q;
      const K = predCov / (predCov + this.R);
      this.x = predX + K * (z - predX);
      this.cov = predCov * (1 - K);
    }
    return this.x;
  }
}

// == Matrix operations ==
const matrixCache = new Float32Array(16);
const tempVec = new Vector3();

function quaternionToMatrix(q, out = matrixCache) {
  const { x, y, z, w } = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;

  out[0] = 1 - 2 * (yy + zz);
  out[1] = 2 * (xy - wz);
  out[2] = 2 * (xz + wy);
  out[3] = 0;

  out[4] = 2 * (xy + wz);
  out[5] = 1 - 2 * (xx + zz);
  out[6] = 2 * (yz - wx);
  out[7] = 0;

  out[8] = 2 * (xz - wy);
  out[9] = 2 * (yz + wx);
  out[10] = 1 - 2 * (xx + yy);
  out[11] = 0;

  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = 1;

  return out;
}

function multiplyMatrixVec(m, v, out = tempVec) {
  const x = v.x, y = v.y, z = v.z;
  out.x = m[0] * x + m[1] * y + m[2] * z + m[3];
  out.y = m[4] * x + m[5] * y + m[6] * z + m[7];
  out.z = m[8] * x + m[9] * y + m[10] * z + m[11];
  return out;
}

// == Crosshair Head Tracker ==
class CrosshairHeadTracker {
  constructor() {
    this.kalmanX = new KalmanFilter(0.01, 0.0001);
    this.kalmanY = new KalmanFilter(0.01, 0.0001);
    this.kalmanZ = new KalmanFilter(0.01, 0.0001);
    this.lastWorldHead = Vector3.zero();
    this.filteredPos = new Vector3();
    this.worldPos = new Vector3();

    this.modelMatrix = new Float32Array(16);
    this.scaledMatrix = new Float32Array(16);
    this.bindMatrix = new Float32Array(16);

    this.frameCount = 0;
    this.lastPerfCheck = Date.now();
    this.isRunning = false;
    this.animationId = null;

    this.crosshairRedCache = false;
    this.crosshairCheckCounter = 0;
    this.crosshairCheckInterval = 3;
  }

  precomputeBindMatrix(bindpose) {
    const bind = this.bindMatrix;
    bind[0] = bindpose.e00; bind[1] = bindpose.e01; bind[2] = bindpose.e02; bind[3] = bindpose.e03;
    bind[4] = bindpose.e10; bind[5] = bindpose.e11; bind[6] = bindpose.e12; bind[7] = bindpose.e13;
    bind[8] = bindpose.e20; bind[9] = bindpose.e21; bind[10] = bindpose.e22; bind[11] = bindpose.e23;
    bind[12] = bindpose.e30; bind[13] = bindpose.e31; bind[14] = bindpose.e32; bind[15] = bindpose.e33;
  }

  getWorldHeadPos(position, rotation, scale) {
    quaternionToMatrix(rotation, this.modelMatrix);
    const m = this.modelMatrix;
    const scaled = this.scaledMatrix;

    scaled[0] = m[0] * scale.x; scaled[1] = m[1] * scale.y; scaled[2] = m[2] * scale.z; scaled[3] = position.x;
    scaled[4] = m[4] * scale.x; scaled[5] = m[5] * scale.y; scaled[6] = m[6] * scale.z; scaled[7] = position.y;
    scaled[8] = m[8] * scale.x; scaled[9] = m[9] * scale.y; scaled[10] = m[10] * scale.z; scaled[11] = position.z;
    scaled[12] = 0; scaled[13] = 0; scaled[14] = 0; scaled[15] = 1;

    this.worldPos.set(scaled[3], scaled[7], scaled[11]);
    return multiplyMatrixVec(this.bindMatrix, this.worldPos, this.worldPos);
  }

  trackFiltered(vec) {
    this.filteredPos.set(
      this.kalmanX.filter(vec.x),
      this.kalmanY.filter(vec.y),
      this.kalmanZ.filter(vec.z)
    );
    return this.filteredPos;
  }

  lockToBoneHead(position, rotation, scale) {
    const worldHead = this.getWorldHeadPos(position, rotation, scale);
    const filtered = this.trackFiltered(worldHead);
    this.lastWorldHead.copy(filtered);

    if (this.crosshairCheckCounter++ % this.crosshairCheckInterval === 0) {
      this.crosshairRedCache = this.isCrosshairRed();
    }

    if (this.crosshairRedCache) {
      this.setAim(filtered);
    }
  }

  setAim(vec3) {
    if (this.frameCount % 30 === 0) {
      console.log(`🎯 AimLock: ${vec3.x.toFixed(3)}, ${vec3.y.toFixed(3)}, ${vec3.z.toFixed(3)}`);
    }

    if (typeof GameAPI !== "undefined" && GameAPI.setCrosshairTarget) {
      GameAPI.setCrosshairTarget(vec3.x, vec3.y, vec3.z);
    }
  }

  isCrosshairRed() {
    return typeof GameAPI !== "undefined" && GameAPI.crosshairState === "red";
  }

  checkPerformance() {
    const now = Date.now();
    if (!this.lastPerfCheck || isNaN(this.lastPerfCheck)) {
      this.lastPerfCheck = now;
      this.frameCount = 0;
      return;
    }

    const elapsed = now - this.lastPerfCheck;
    if (elapsed >= 1000) {
      const fps = (this.frameCount / elapsed) * 1000;

      if (fps < 50) {
        console.warn(`⚠️ Low FPS detected: ${fps.toFixed(1)} FPS`);
        this.crosshairCheckInterval = Math.min(this.crosshairCheckInterval + 1, 10);
      } else if (fps > 58 && this.crosshairCheckInterval > 1) {
        this.crosshairCheckInterval = Math.max(this.crosshairCheckInterval - 1, 1);
      }

      this.frameCount = 0;
      this.lastPerfCheck = now;
    }
  }

  loop(position, rotation, scale, bindpose) {
    if (this.isRunning) return;

    this.isRunning = true;
    this.precomputeBindMatrix(bindpose);

    this.animationId = setInterval(() => {
      if (!this.isRunning) return;
      this.lockToBoneHead(position, rotation, scale);
      this.frameCount++;
      this.checkPerformance();
    }, 16); // ~60fps
  }

  stop() {
    this.isRunning = false;
    if (this.animationId) {
      clearInterval(this.animationId);
      this.animationId = null;
    }
  }

  restart(position, rotation, scale, bindpose) {
    this.stop();
    setTimeout(() => this.loop(position, rotation, scale, bindpose), 16);
  }
}

// == Bone Head Data ==
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

// == Run Tracker ==
const crosshairLock = new CrosshairHeadTracker();
crosshairLock.loop(
  bone_Head.position,
  bone_Head.rotation,
  bone_Head.scale,
  bone_Head.bindpose
);

// == Global Controls ==
window.stopTracker = () => crosshairLock.stop();
window.restartTracker = () =>
  crosshairLock.restart(bone_Head.position, bone_Head.rotation, bone_Head.scale, bone_Head.bindpose);

console.log("🚀 Optimized Crosshair Head Tracker started!");
console.log("Use stopTracker() and restartTracker() to control the tracker.");
