// ==UserScript==
// @name         Shadowrocket Instant Head Tracker
// @namespace    http://garena.freefire/
// @match        *api.ff.garena.com*
// @run-at       response
// ==/UserScript==

let body = $response.body;

// Nếu là JSON thì parse thử
try { body = JSON.parse($response.body); } catch (e) {}

class Vector3 {
  constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  copy(v){this.x=v.x;this.y=v.y;this.z=v.z;return this;}
  clone(){return new Vector3(this.x,this.y,this.z);}
  static zero(){return new Vector3(0,0,0);}
}

class AdaptiveKalmanFilter {
  constructor(R=0.01,Q=0.0001){
    this.R=R;this.baseR=R;
    this.Q=Q;this.baseQ=Q;
    this.cov=NaN;this.x=NaN;
    this.isInitialized=false;
    this.innovationHistory=[];this.maxHistorySize=10;
  }
  adaptParameters(innovation){
    this.innovationHistory.push(Math.abs(innovation));
    if(this.innovationHistory.length>this.maxHistorySize) this.innovationHistory.shift();
    const avg= this.innovationHistory.reduce((a,b)=>a+b,0)/this.innovationHistory.length;
    if(avg>0.1){ this.R=this.baseR*2; this.Q=this.baseQ*0.5; }
    else { this.R=this.baseR; this.Q=this.baseQ; }
  }
  filter(z){
    if(!this.isInitialized){
      this.x=z; this.cov=this.R; this.isInitialized=true;
      return this.x;
    }
    const predX=this.x, predCov=this.cov+this.Q;
    const innovation=z-predX;
    this.adaptParameters(innovation);
    const K=predCov/(predCov+this.R);
    this.x=predX+K*innovation;
    this.cov=predCov*(1-K);
    return this.x;
  }
  reset(){
    this.isInitialized=false;
    this.innovationHistory=[];
    this.R=this.baseR; this.Q=this.baseQ;
  }
}

const matrixPool = {
  matrices:[new Float32Array(16), new Float32Array(16), new Float32Array(16)],
  idx:0,
  get(){const m=this.matrices[this.idx]; this.idx=(this.idx+1)%this.matrices.length; return m;}
};

function quaternionToMatrix(q,out){
  const {x,y,z,w}=q;
  const x2=x+x,y2=y+y,z2=z+z;
  const xx=x*x2,xy=x*y2,xz=x*z2;
  const yy=y*y2,yz=y*z2,zz=z*z2;
  const wx=w*x2,wy=w*y2,wz=w*z2;
  out[0]=1-(yy+zz); out[1]=xy-wz; out[2]=xz+wy; out[3]=0;
  out[4]=xy+wz; out[5]=1-(xx+zz); out[6]=yz-wx; out[7]=0;
  out[8]=xz-wy; out[9]=yz+wx; out[10]=1-(xx+yy); out[11]=0;
  out[12]=0;out[13]=0;out[14]=0;out[15]=1;
  return out;
}

function multiplyMatrixVec(m,v,out){
  out.x=m[0]*v.x + m[1]*v.y + m[2]*v.z + m[3];
  out.y=m[4]*v.x + m[5]*v.y + m[6]*v.z + m[7];
  out.z=m[8]*v.x + m[9]*v.y + m[10]*v.z+ m[11];
  return out;
}

class ShadowrocketHeadTracker {
  constructor(){
    this.kx=new AdaptiveKalmanFilter();
    this.ky=new AdaptiveKalmanFilter();
    this.kz=new AdaptiveKalmanFilter();
    this.worldPos = Vector3.zero();
    this.filtered = Vector3.zero();
    this.modelMatrix=new Float32Array(16);
    this.scaledMatrix=new Float32Array(16);
    this.bindMatrix=new Float32Array(16);
    this.isRunning=false;
    this.intervalId=null;
    this.frameInterval=8;
    this.networkMonitor=null;
    this.crosshairRedCache=false;
    this.checkCounter=0;
    this.checkInterval=3;
    this.lastAimTime=0;
    this.aimCooldown=0; // zero delay
    this.humanize=false; // disable jitter
  }

  precomputeBindMatrix(bindpose){
    const b=this.bindMatrix;
    b[0]=bindpose.e00;b[1]=bindpose.e01;b[2]=bindpose.e02;b[3]=bindpose.e03;
    b[4]=bindpose.e10;b[5]=bindpose.e11;b[6]=bindpose.e12;b[7]=bindpose.e13;
    b[8]=bindpose.e20;b[9]=bindpose.e21;b[10]=bindpose.e22;b[11]=bindpose.e23;
    b[12]=bindpose.e30;b[13]=bindpose.e31;b[14]=bindpose.e32;b[15]=bindpose.e33;
  }

  getWorldHeadPos(position,rotation,scale){
    const outMat=this.modelMatrix;
    quaternionToMatrix(rotation,outMat);
    const m=outMat, s=this.scaledMatrix;
    const sx=scale.x,sy=scale.y,sz=scale.z;
    s[0]=m[0]*sx; s[1]=m[1]*sy; s[2]=m[2]*sz; s[3]=position.x;
    s[4]=m[4]*sx; s[5]=m[5]*sy; s[6]=m[6]*sz; s[7]=position.y;
    s[8]=m[8]*sx; s[9]=m[9]*sy; s[10]=m[10]*sz; s[11]=position.z;
    s[12]=0;s[13]=0;s[14]=0;s[15]=1;
    this.worldPos.set(s[3], s[7], s[11]);
    return multiplyMatrixVec(this.bindMatrix, this.worldPos, this.worldPos);
  }

  isCrosshairRed(){
    try{
      if(typeof GameAPI !== "undefined") return GameAPI.crosshairState==="red"||GameAPI.targetLocked;
      if(typeof window !== "undefined" && window.GameAPI) return window.GameAPI.crosshairState==="red"||window.GameAPI.targetLocked;
    }catch{}
    return true;
  }

  lockToBoneHead(position,rotation,scale){
    const raw = this.getWorldHeadPos(position,rotation,scale);
    const fx = this.kx.filter(raw.x);
    const fy = this.ky.filter(raw.y);
    const fz = this.kz.filter(raw.z);
    this.filtered.set(fx,fy,fz);
    if(this.checkCounter++ % this.checkInterval === 0) {
      this.crosshairRedCache = this.isCrosshairRed();
    }
    if(this.crosshairRedCache){
      GameAPI?.setCrosshairTarget?.(fx,fy,fz);
      this.lastAimTime = Date.now();
    }
  }

  async loop(position,rotation,scale,bindpose){
    if(this.isRunning) this.stop();
    this.isRunning=true;
    this.precomputeBindMatrix(bindpose);
    const run = async ()=>{
      if(!this.isRunning)return;
      if(this.isCrosshairRed()||this.crosshairRedCache) {
        this.lockToBoneHead(position,rotation,scale);
      }
      this.intervalId = setTimeout(run, this.frameInterval);
    };
    run();
  }

  stop(){
    if(this.intervalId!==null) clearTimeout(this.intervalId);
    this.isRunning=false;
  }

  getStatus(){
    return {
      isRunning:this.isRunning,
      lastAim: this.lastAimTime
    };
  }
}

// === Usage Example ===
const bone_Head = {
  position: {x:-0.0456970781,y:-0.004478302,z:-0.0200432576},
  rotation: {x:0.0258174837,y:-0.08611039,z:-0.1402113,w:0.9860321},
  scale: {x:0.99999994,y:1.00000012,z:1.0},
  bindpose:{
    e00:-1.34559613e-13,e01:8.881784e-14,e02:-1.0,e03:0.487912,
    e10:-2.84512817e-6,e11:-1.0,e12:8.881784e-14,e13:-2.842171e-14,
    e20:-1.0,e21:2.84512817e-6,e22:-1.72951931e-13,e23:0.0,
    e30:0.0,e31:0.0,e32:0.0,e33:1.0
  }
};

const tracker = new ShadowrocketHeadTracker();
tracker.loop(bone_Head.position, bone_Head.rotation, bone_Head.scale, bone_Head.bindpose);

window.stopTracker = ()=> tracker.stop();
window.getTrackerStatus = ()=> tracker.getStatus();

console.log("🚀 Tracker started: instant head snap, no jitter.");
// Trả về body gốc
if (typeof body === "object") {
  $done({ body: JSON.stringify(body) });
} else {
  $done({ body });
}
