const t=value=>globalThis.CNCVexaI18n?.translateString(String(value))??String(value);
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const TAU=Math.PI*2;

export class LatheSimulator{
  constructor(canvas){
    this.canvas=canvas;
    this.ctx=canvas.getContext('2d');
    this.active=false;
    this.viewMode='3d';
    this.showRapids=true;
    this.showCuts=true;
    this.showGrid=true;
    this.showTable=true;
    this.showTurret=true;
    this.showCollisions=true;
    this.renderQuality='high';
    this.playbackActive=false;
    this.current=-1;
    this.path=[];
    this.toolPos={x:80,z:5};
    this.currentTool={type:'od',name:'Buril exterior',noseRadius:.8,orientation:3,insertWidth:6};
    this.activeToolNumber=0;
    this.activeOffset=0;
    this.turretAngle=Math.PI;
    this.turretTargetAngle=Math.PI;
    this.turretAnimation=null;
    this.collisionMarkers=[];
    this.threadSegments=[];
    this.camera={yaw:-32*Math.PI/180,pitch:18*Math.PI/180,zoom:1,panX:0,panY:0,fov:37*Math.PI/180,near:.1,target:null,position:null,up:{x:0,y:1,z:0},fitDistance:0};
    this.drag=null;
    this.resizeObserver=new ResizeObserver(()=>this.resize());
    this.resizeObserver.observe(canvas);
    this.bindControls();
    this.configure({units:'mm',diameter:60,length:120,bore:0,stickout:100,chuckLength:30,resolution:1,renderQuality:'high'});
  }

  setActive(value=true){this.active=!!value;if(this.active)this.resize();}
  setPlaybackActive(value=false){this.playbackActive=!!value;}
  setDisplayMode(mode='3d'){this.viewMode=mode==='2d'?'2d':'3d';this.draw();}
  setRenderQuality(level='high'){this.renderQuality=['low','medium','high','ultra'].includes(level)?level:'high';this.draw();}
  getCamera(){return{...this.camera,target:this.camera.target?{...this.camera.target}:null,position:this.camera.position?{...this.camera.position}:null,up:{...this.camera.up},viewMode:this.viewMode};}
  setCamera(camera={}){
    Object.assign(this.camera,camera);
    if(camera.target)this.camera.target={...camera.target};
    this.camera.fov=clamp(Number(this.camera.fov)||37*Math.PI/180,30*Math.PI/180,48*Math.PI/180);
    this.camera.pitch=clamp(Number(this.camera.pitch)||18*Math.PI/180,-1.15,1.15);
    this.camera.zoom=this.clampZoom(Number(this.camera.zoom)||1);
    if(camera.viewMode)this.viewMode=camera.viewMode;
    if(!this.camera.target||!Number.isFinite(this.camera.fitDistance)||this.camera.fitDistance<=0)this.fitView(false);
    this.draw();
  }
  setCurrentTool(tool={}){this.currentTool={...this.currentTool,...tool};this.draw();}

  bindControls(){
    this.canvas.addEventListener('contextmenu',e=>{if(this.active)e.preventDefault();});
    this.canvas.addEventListener('pointerdown',e=>{
      if(!this.active)return;
      this.canvas.setPointerCapture(e.pointerId);
      if(e.pointerType==='touch'){
        this.touchPoints??=new Map();this.touchPoints.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if(this.touchPoints.size>=2){const [a,b]=[...this.touchPoints.values()];this.pinchDistance=Math.hypot(a.x-b.x,a.y-b.y);this.drag=null;this.canvas.classList.remove('dragging');return;}
      }
      this.drag={x:e.clientX,y:e.clientY,mode:this.viewMode==='2d'?'pan':(e.button===2||e.shiftKey?'pan':'rotate')};
      this.canvas.classList.add('dragging');
    });
    this.canvas.addEventListener('pointermove',e=>{
      if(e.pointerType==='touch'&&this.touchPoints?.has(e.pointerId)){
        this.touchPoints.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if(this.touchPoints.size>=2){const [a,b]=[...this.touchPoints.values()],distance=Math.hypot(a.x-b.x,a.y-b.y);if(this.pinchDistance>0)this.camera.zoom=this.clampZoom(this.camera.zoom*(distance/this.pinchDistance));this.pinchDistance=distance;this.draw();return;}
      }
      if(!this.drag)return;
      const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;
      this.drag.x=e.clientX;this.drag.y=e.clientY;
      if(this.drag.mode==='rotate'){
        this.camera.yaw+=dx*.008;
        this.camera.pitch=clamp(this.camera.pitch+dy*.008,-1.15,1.15);
      }else{
        this.camera.panX+=dx;
        this.camera.panY+=dy;
      }
      this.draw();
    });
    const release=e=>{if(e?.pointerType==='touch'){this.touchPoints?.delete(e.pointerId);if((this.touchPoints?.size||0)<2)this.pinchDistance=0;}this.drag=null;this.canvas.classList.remove('dragging');};
    this.canvas.addEventListener('pointerup',release);
    this.canvas.addEventListener('pointercancel',release);
    this.canvas.addEventListener('wheel',e=>{
      if(!this.active)return;
      e.preventDefault();
      this.camera.zoom=this.clampZoom(this.camera.zoom*Math.exp(-e.deltaY*.0012));
      this.draw();
    },{passive:false});
    this.canvas.addEventListener('dblclick',()=>{if(this.active)this.fitView();});
  }

  configure(cfg={}){
    const length=Math.max(1,+cfg.length||120);
    const stickout=clamp(+cfg.stickout||length,1,length);
    this.cfg={
      units:cfg.units==='in'?'in':'mm',
      diameter:Math.max(1,+cfg.diameter||60),
      length,
      bore:Math.max(0,+cfg.bore||0),
      stickout,
      chuckLength:Math.max(5,+cfg.chuckLength||30),
      resolution:Math.max(.2,+cfg.resolution||1),
      renderQuality:cfg.renderQuality||'high'
    };
    this.renderQuality=this.cfg.renderQuality;
    this.count=Math.ceil(this.cfg.length/this.cfg.resolution)+1;
    this.profile=new Float32Array(this.count);
    this.profile.fill(this.cfg.diameter/2);
    this.innerProfile=new Float32Array(this.count);
    this.innerProfile.fill(this.cfg.bore/2);
    this.path=[];
    this.current=-1;
    this.toolPos={x:this.cfg.diameter+20,z:5};
    this.collisionMarkers=[];
    this.threadSegments=[];
    this.fitView(false);
    this.draw();
  }

  resetCut(){
    this.profile.fill(this.cfg.diameter/2);
    this.innerProfile.fill(this.cfg.bore/2);
    this.current=-1;
    this.toolPos={x:this.cfg.diameter+20,z:5};
    this.collisionMarkers=[];
    this.threadSegments=[];
    this.draw();
  }

  setPath(path){this.path=path||[];this.current=-1;this.draw();}
  fitView(redraw=true){
    this.camera.zoom=1;this.camera.panX=0;this.camera.panY=0;
    if(this.viewMode==='3d'){
      const bounds=this.sceneBounds3D(),target=this.boundsCenter(bounds);
      this.camera.target=target;
      this.camera.near=Math.max(.08,this.boundsRadius(bounds)*.008);
      this.camera.fitDistance=this.fitDistanceForBounds(bounds,target,1.14);
      this.updateCameraPose();
    }
    if(redraw)this.draw();
  }

  applyStep(step,redraw=true){
    const options=arguments[2]||{};
    if(!step)return;
    this.current++;
    if(step.kind==='toolchange'){
      this.activeToolNumber=step.toTool||step.tool||0;
      this.activeOffset=step.offset||this.activeToolNumber;
      this.currentTool={...this.currentTool,type:step.toolType||this.currentTool.type,name:step.toolName||this.currentTool.name,noseRadius:step.noseRadius??this.currentTool.noseRadius,insertWidth:step.insertWidth||this.currentTool.insertWidth,orientation:step.orientation||this.currentTool.orientation};
      if(redraw)this.animateTurretTo(this.activeToolNumber);else this.setTurretStation(this.activeToolNumber);
      if(redraw)this.draw();
      return;
    }
    if(step.kind!=='move')return;
    this.toolPos={...step.to};
    this.activeToolNumber=step.tool||this.activeToolNumber;
    this.activeOffset=step.offset||this.activeOffset;
    this.currentTool={...this.currentTool,type:step.toolType||this.currentTool.type,name:step.toolName||this.currentTool.name,noseRadius:step.noseRadius??this.currentTool.noseRadius,insertWidth:step.insertWidth||this.currentTool.insertWidth,orientation:step.orientation||this.currentTool.orientation};
    if(step.cut&&!options.skipCut)this.cutSegment(step.from,step.to,this.currentTool);
    if(step.cycle==='G76'&&step.thread)this.threadSegments.push({...step});
    if(step.collisions?.length)this.collisionMarkers.push({point:{...step.to},line:step.line,issues:step.collisions});
    if(redraw)this.draw();
  }

  applyMaterialDeltas(indices,values,innerIndices=null,innerValues=null){
    if(indices&&values)for(let i=0;i<indices.length;i++)this.profile[indices[i]]=values[i];
    if(innerIndices&&innerValues)for(let i=0;i<innerIndices.length;i++)this.innerProfile[innerIndices[i]]=innerValues[i];
  }

  turretStationAngle(toolNumber){
    const stations=8,index=(Math.max(1,toolNumber)-1)%stations;
    return Math.PI-index/stations*TAU;
  }

  setTurretStation(toolNumber){this.turretTargetAngle=this.turretStationAngle(toolNumber);this.turretAngle=this.turretTargetAngle;}

  animateTurretTo(toolNumber){
    this.turretTargetAngle=this.turretStationAngle(toolNumber);
    if(this.turretAnimation)cancelAnimationFrame(this.turretAnimation);
    const tick=()=>{
      let delta=this.turretTargetAngle-this.turretAngle;
      while(delta>Math.PI)delta-=TAU;
      while(delta<-Math.PI)delta+=TAU;
      if(Math.abs(delta)<.012){
        this.turretAngle=this.turretTargetAngle;
        this.turretAnimation=null;
        this.draw();
        return;
      }
      this.turretAngle+=delta*.18;
      this.draw();
      this.turretAnimation=requestAnimationFrame(tick);
    };
    this.turretAnimation=requestAnimationFrame(tick);
  }

  cutSegment(a,b,tool){
    const len=Math.hypot(b.x-a.x,b.z-a.z),samples=Math.max(1,Math.ceil(len/Math.max(.25,this.cfg.resolution*.45))),nose=Math.max(.1,tool.noseRadius||.8);
    for(let s=0;s<=samples;s++){
      const t=s/samples,x=lerp(a.x,b.x,t),z=lerp(a.z,b.z,t),r=Math.abs(x)/2;
      if(z>nose||z<-this.cfg.length-nose)continue;
      const i0=Math.max(0,Math.floor((-z-nose)/this.cfg.resolution)),i1=Math.min(this.count-1,Math.ceil((-z+nose)/this.cfg.resolution));
      for(let i=i0;i<=i1;i++){
        const zi=-i*this.cfg.resolution,dz=Math.abs(zi-z);
        if(dz>nose)continue;
        const effective=r+Math.max(0,nose-Math.sqrt(Math.max(0,nose*nose-dz*dz)));
        if(tool.type==='boring'||tool.type==='drill')this.innerProfile[i]=Math.max(this.innerProfile[i],effective);
        else this.profile[i]=Math.max(this.innerProfile[i]+.05,Math.min(this.profile[i],effective));
      }
    }
  }

  resize(){
    if(!this.active)return;
    const r=this.canvas.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);
    this.canvas.width=Math.max(1,Math.round(r.width*dpr));
    this.canvas.height=Math.max(1,Math.round(r.height*dpr));
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
    const changed=this.w!==r.width||this.h!==r.height;this.w=r.width;this.h=r.height;
    if(changed&&this.viewMode==='3d'&&this.camera.target)this.camera.fitDistance=this.fitDistanceForBounds(this.sceneBounds3D(),this.camera.target,1.14);
    this.draw();
  }

  quality(){return{low:{rings:12,step:4},medium:{rings:18,step:3},high:{rings:28,step:2},ultra:{rings:40,step:1}}[this.renderQuality]||{rings:28,step:2};}
  chuckFaceZ(){return-Math.min(this.cfg.stickout,this.cfg.length);}
  exposedCount(){return Math.min(this.count,Math.ceil(this.cfg.stickout/this.cfg.resolution)+1);}
  draw(){if(!this.active||!this.w||!this.h)return;if(this.viewMode==='2d')this.draw2D();else this.draw3D();}

  drawBackground(dark=true){
    const c=this.ctx;c.clearRect(0,0,this.w,this.h);
    if(!dark){c.fillStyle='#fbfbfb';c.fillRect(0,0,this.w,this.h);return;}
    const g=c.createRadialGradient(this.w*.5,this.h*.34,20,this.w*.5,this.h*.52,Math.max(this.w,this.h));
    g.addColorStop(0,'#183544');g.addColorStop(.48,'#0c202b');g.addColorStop(1,'#050c12');
    c.fillStyle=g;c.fillRect(0,0,this.w,this.h);
    const floor=c.createLinearGradient(0,this.h*.64,0,this.h);
    floor.addColorStop(0,'rgba(18,42,53,0)');floor.addColorStop(1,'rgba(2,7,10,.78)');
    c.fillStyle=floor;c.fillRect(0,this.h*.55,this.w,this.h*.45);
  }

  bounds2D(){const maxD=this.cfg.diameter+60;return{minZ:this.chuckFaceZ()-this.cfg.chuckLength-24,maxZ:40,minX:-maxD,maxX:maxD};}
  project2D(z,x){const b=this.bounds2D(),pad=42,scale=Math.min((this.w-pad*2)/(b.maxZ-b.minZ),(this.h-pad*2)/(b.maxX-b.minX))*this.camera.zoom;return{x:pad+(z-b.minZ)*scale+this.camera.panX,y:this.h/2-x*scale+this.camera.panY,scale};}

  draw2D(){
    this.drawBackground(false);
    const c=this.ctx,b=this.bounds2D(),zero=this.project2D(0,0);
    if(this.showGrid){
      c.strokeStyle='#d8edf4';c.lineWidth=1;
      const step=10;
      for(let z=Math.ceil(b.minZ/step)*step;z<=b.maxZ;z+=step){const a=this.project2D(z,b.minX),d=this.project2D(z,b.maxX);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(d.x,d.y);c.stroke();}
      for(let x=Math.ceil(b.minX/step)*step;x<=b.maxX;x+=step){const a=this.project2D(b.minZ,x),d=this.project2D(b.maxZ,x);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(d.x,d.y);c.stroke();}
    }
    c.strokeStyle='#7ca7bb';c.lineWidth=1.4;c.setLineDash([8,5]);c.beginPath();c.moveTo(this.project2D(b.minZ,0).x,zero.y);c.lineTo(this.project2D(b.maxZ,0).x,zero.y);c.stroke();c.setLineDash([]);
    this.drawLatheBed2D();
    this.drawWorkpiece2D();
    if(this.showTable)this.drawChuck2D();
    this.drawPath2D();
    if(this.showTurret)this.drawTurret2D();
    this.drawTool2D();
    if(this.showCollisions)this.drawCollisions2D();
    c.fillStyle='#1b3441';c.font='700 12px system-ui';c.fillText(t('Perfil X–Z · X programado en diámetro'),18,24);c.font='10px system-ui';c.fillStyle='#5f7f8d';c.fillText(t('Z0 = cara frontal · el plato sujeta la barra en Z negativo'),18,41);
  }

  drawLatheBed2D(){
    const c=this.ctx,b=this.bounds2D(),a=this.project2D(b.minZ,-b.maxX*.78),d=this.project2D(b.maxZ,-b.maxX*.98);
    c.fillStyle='#d8e0e4';c.fillRect(a.x,a.y,d.x-a.x,Math.max(12,d.y-a.y));
    c.strokeStyle='#9aabb4';c.lineWidth=2;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(d.x,a.y);c.stroke();
  }

  drawWorkpiece2D(){
    const c=this.ctx,visible=this.exposedCount(),top=[],bottom=[];
    for(let i=0;i<visible;i++){const z=-i*this.cfg.resolution,r=this.profile[i];top.push(this.project2D(z,r));bottom.push(this.project2D(z,-r));}
    if(top.length<2)return;
    const grad=c.createLinearGradient(0,top[0].y,0,bottom[0].y);grad.addColorStop(0,'#f3cd62');grad.addColorStop(.48,'#d9a72d');grad.addColorStop(1,'#9b6715');
    c.beginPath();c.moveTo(top[0].x,top[0].y);for(const p of top)c.lineTo(p.x,p.y);for(let i=bottom.length-1;i>=0;i--)c.lineTo(bottom[i].x,bottom[i].y);c.closePath();c.fillStyle=grad;c.fill();c.strokeStyle='#76500f';c.lineWidth=1.5;c.stroke();
    const outer=this.profile[0],inner=this.innerProfile[0],front=this.project2D(0,0),scale=front.scale;
    c.fillStyle='#e6b744';c.beginPath();c.ellipse(front.x,front.y,Math.max(2,outer*scale*.12),outer*scale,0,0,TAU);c.fill();c.strokeStyle='#815d18';c.stroke();
    if(inner>.05){c.fillStyle='#f8f8f8';c.beginPath();c.ellipse(front.x,front.y,Math.max(1,inner*scale*.12),inner*scale,0,0,TAU);c.fill();c.stroke();}
  }

  drawChuck2D(){
    const c=this.ctx,face=this.chuckFaceZ(),back=face-this.cfg.chuckLength,r=Math.max(this.cfg.diameter*.72,34),a=this.project2D(back,r),b=this.project2D(face,-r);
    const grad=c.createLinearGradient(a.x,0,b.x,0);grad.addColorStop(0,'#414d54');grad.addColorStop(.55,'#69777e');grad.addColorStop(1,'#87949a');
    c.fillStyle=grad;c.fillRect(a.x,a.y,b.x-a.x,b.y-a.y);c.strokeStyle='#26353d';c.lineWidth=1.5;c.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);
    const faceP=this.project2D(face,0),barR=this.cfg.diameter/2,jawR=r*.86,jawH=Math.max(8,(jawR-barR)*.72),jawW=Math.max(8,this.cfg.chuckLength*.34*faceP.scale);
    for(const sign of [-1,1]){
      const y=faceP.y-sign*(barR+jawH*.5)*faceP.scale;
      c.fillStyle='#303a40';c.strokeStyle='#111a1f';c.lineWidth=1.2;c.fillRect(faceP.x-jawW*.68,y-jawH*.5*faceP.scale,jawW,jawH*faceP.scale);c.strokeRect(faceP.x-jawW*.68,y-jawH*.5*faceP.scale,jawW,jawH*faceP.scale);
      c.fillStyle='#59676e';c.fillRect(faceP.x-jawW*.24,y-jawH*.42*faceP.scale,jawW*.62,jawH*.84*faceP.scale);
    }
    c.strokeStyle='#16242b';c.lineWidth=2;c.beginPath();c.moveTo(faceP.x,a.y);c.lineTo(faceP.x,b.y);c.stroke();
  }

  drawPath2D(){
    const c=this.ctx;
    for(let i=0;i<this.path.length;i++){
      const s=this.path[i];if(s.kind!=='move'||(s.type==='G00'&&!this.showRapids)||(s.type!=='G00'&&!this.showCuts))continue;
      const a=this.project2D(s.from.z,s.from.x/2),b=this.project2D(s.to.z,s.to.x/2),done=i<=this.current;
      c.strokeStyle=done?(s.type==='G00'?'#3d9fca':'#0e8f56'):(s.type==='G00'?'rgba(61,159,202,.35)':'rgba(20,60,70,.35)');c.setLineDash(s.type==='G00'?[6,5]:[]);c.lineWidth=i===this.current?2.8:1.4;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
    }
    c.setLineDash([]);
  }

  toolLayout(){
    const type=this.currentTool.type||'od',tip={x:this.toolPos.z,y:this.toolPos.x/2,z:0};
    if(type==='drill')return{type,tip,back:{x:tip.x+54,y:tip.y,z:0},turret:{x:tip.x+68,y:tip.y+28,z:18},holderWidth:Math.max(5,(this.currentTool.insertWidth||10)*.72)};
    if(type==='boring')return{type,tip,back:{x:tip.x+44,y:tip.y+10,z:8},turret:{x:tip.x+62,y:tip.y+40,z:22},holderWidth:Math.max(5,(this.currentTool.insertWidth||5)*.82)};
    return{type,tip,back:{x:tip.x+24,y:tip.y+31,z:15},turret:{x:tip.x+34,y:tip.y+61,z:25},holderWidth:Math.max(5,(this.currentTool.insertWidth||6)*.9)};
  }

  drawTurret2D(){
    const c=this.ctx,l=this.toolLayout(),p=this.project2D(l.turret.x,l.turret.y),r=Math.max(29,p.scale*19);
    c.save();c.translate(p.x,p.y);c.rotate(this.turretAngle);
    const grad=c.createRadialGradient(-r*.25,-r*.25,3,0,0,r);grad.addColorStop(0,'#7e8d94');grad.addColorStop(.66,'#47555c');grad.addColorStop(1,'#263238');
    c.fillStyle=grad;c.strokeStyle='#152127';c.lineWidth=2;c.beginPath();for(let i=0;i<8;i++){const a=i/8*TAU-Math.PI/8,x=Math.cos(a)*r,y=Math.sin(a)*r;i?c.lineTo(x,y):c.moveTo(x,y);}c.closePath();c.fill();c.stroke();
    for(let i=0;i<8;i++){const a=i/8*TAU,x=Math.cos(a)*r*.72,y=Math.sin(a)*r*.72;c.fillStyle=i===(this.activeToolNumber-1+8)%8?'#ffd21f':'#aab6bc';c.strokeStyle='#26343a';c.beginPath();c.rect(x-r*.08,y-r*.06,r*.16,r*.12);c.fill();c.stroke();}
    c.rotate(-this.turretAngle);c.fillStyle='#eef5f8';c.font='700 10px system-ui';c.textAlign='center';c.fillText(`T${String(this.activeToolNumber||0).padStart(2,'0')}`,0,4);c.restore();
    const baseA=this.project2D(l.turret.x-18,l.turret.y-22),baseB=this.project2D(l.turret.x+45,l.turret.y+5);c.fillStyle='#59676e';c.strokeStyle='#26343a';c.fillRect(baseA.x,baseB.y,baseB.x-baseA.x,baseA.y-baseB.y);c.strokeRect(baseA.x,baseB.y,baseB.x-baseA.x,baseA.y-baseB.y);
  }

  drawTool2D(){
    const c=this.ctx,l=this.toolLayout(),tip=this.project2D(l.tip.x,l.tip.y),back=this.project2D(l.back.x,l.back.y),dx=tip.x-back.x,dy=tip.y-back.y,len=Math.max(1,Math.hypot(dx,dy)),nx=-dy/len,ny=dx/len,w=Math.max(5,l.holderWidth*tip.scale*.65);
    c.save();
    const grad=c.createLinearGradient(back.x,back.y,tip.x,tip.y);grad.addColorStop(0,'#506068');grad.addColorStop(.55,'#c4d0d5');grad.addColorStop(1,'#758990');
    c.fillStyle=grad;c.strokeStyle='#26343b';c.lineWidth=1.2;c.beginPath();c.moveTo(back.x+nx*w,back.y+ny*w);c.lineTo(tip.x+nx*w*.46,tip.y+ny*w*.46);c.lineTo(tip.x-nx*w*.46,tip.y-ny*w*.46);c.lineTo(back.x-nx*w,back.y-ny*w);c.closePath();c.fill();c.stroke();
    this.drawInsertScreen(tip,Math.max(6,w*1.18),Math.atan2(dy,dx),l.type);
    c.restore();
  }

  drawInsertScreen(p,size,angle,type){
    const c=this.ctx;c.save();c.translate(p.x,p.y);c.rotate(angle);c.strokeStyle='#3f350b';c.lineWidth=1.1;c.fillStyle=type==='thread'?'#f4a64a':type==='groove'?'#71d0de':type==='drill'?'#dce4e8':type==='boring'?'#ffd35b':'#ffd21f';
    c.beginPath();
    if(type==='groove'){c.rect(-size*.9,-size*.28,size*.95,size*.56);}
    else if(type==='thread'){c.moveTo(0,0);c.lineTo(-size*.95,-size*.58);c.lineTo(-size*.95,size*.58);c.closePath();}
    else if(type==='drill'){c.moveTo(0,0);c.lineTo(-size*1.2,-size*.62);c.lineTo(-size*1.2,size*.62);c.closePath();}
    else if(type==='boring'){c.moveTo(0,0);c.lineTo(-size*.9,-size*.5);c.lineTo(-size*.78,size*.52);c.closePath();}
    else if(type==='finish'){c.moveTo(0,0);c.lineTo(-size*.85,-size*.65);c.lineTo(-size*1.12,0);c.lineTo(-size*.85,size*.65);c.closePath();}
    else{c.moveTo(0,0);c.lineTo(-size,-size*.72);c.lineTo(-size*1.18,size*.28);c.lineTo(-size*.42,size*.62);c.closePath();}
    c.fill();c.stroke();c.restore();
  }

  drawCollisions2D(){
    const c=this.ctx;for(const marker of this.collisionMarkers){const p=this.project2D(marker.point.z,marker.point.x/2);c.strokeStyle='#ff4157';c.fillStyle='rgba(255,65,87,.18)';c.lineWidth=2;c.beginPath();c.arc(p.x,p.y,8,0,TAU);c.fill();c.stroke();c.beginPath();c.moveTo(p.x-5,p.y-5);c.lineTo(p.x+5,p.y+5);c.moveTo(p.x+5,p.y-5);c.lineTo(p.x-5,p.y+5);c.stroke();}
  }

  boundsCenter(bounds){return{x:(bounds.minX+bounds.maxX)/2,y:(bounds.minY+bounds.maxY)/2,z:(bounds.minZ+bounds.maxZ)/2};}
  boundsRadius(bounds){return Math.max(1,Math.hypot(bounds.maxX-bounds.minX,bounds.maxY-bounds.minY,bounds.maxZ-bounds.minZ)/2);}
  expandBounds(bounds,point){bounds.minX=Math.min(bounds.minX,point.x);bounds.maxX=Math.max(bounds.maxX,point.x);bounds.minY=Math.min(bounds.minY,point.y);bounds.maxY=Math.max(bounds.maxY,point.y);bounds.minZ=Math.min(bounds.minZ,point.z);bounds.maxZ=Math.max(bounds.maxZ,point.z);}

  sceneBounds3D(){
    const d=this.cfg.diameter,face=this.chuckFaceZ(),back=face-this.cfg.chuckLength,r=Math.max(d*.72,34),bounds={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity};
    const addBox=(minX,maxX,minY,maxY,minZ,maxZ)=>{this.expandBounds(bounds,{x:minX,y:minY,z:minZ});this.expandBounds(bounds,{x:maxX,y:maxY,z:maxZ});};
    addBox(-this.cfg.stickout,0,-d/2,d/2,-d/2,d/2);
    addBox(back-24,face+15,-r*.96,r*.96,-r*.96,r*.96);
    addBox(face-this.cfg.chuckLength-35,55,-d*1.7,d*1.7,-d*1.34,-d*.42);
    const layout=this.turretWorldLayout(),{center,radius,thickness}=layout,toolMargin=Math.max(4,layout.holderWidth);
    addBox(center.x-thickness/2-42,center.x+thickness/2+55,center.y-radius-22,center.y+radius+28,Math.min(center.z-radius,-d*.92),Math.max(center.z+radius,-d*.42));
    for(const point of [layout.tip,layout.back])addBox(point.x-toolMargin,point.x+toolMargin,point.y-toolMargin,point.y+toolMargin,point.z-toolMargin,point.z+toolMargin);
    const margin=Math.max(3,d*.06);
    return{minX:bounds.minX-margin,maxX:bounds.maxX+margin,minY:bounds.minY-margin,maxY:bounds.maxY+margin,minZ:bounds.minZ-margin,maxZ:bounds.maxZ+margin};
  }

  orbitVector(){
    const cy=Math.cos(this.camera.yaw),sy=Math.sin(this.camera.yaw),cp=Math.cos(this.camera.pitch),sp=Math.sin(this.camera.pitch);
    return{x:sy*cp,y:sp,z:cy*cp};
  }

  frameFor(target,distance){
    const orbit=this.orbitVector(),position={x:target.x+orbit.x*distance,y:target.y+orbit.y*distance,z:target.z+orbit.z*distance};
    const forwardRaw={x:target.x-position.x,y:target.y-position.y,z:target.z-position.z},forwardLength=Math.hypot(forwardRaw.x,forwardRaw.y,forwardRaw.z)||1,forward={x:forwardRaw.x/forwardLength,y:forwardRaw.y/forwardLength,z:forwardRaw.z/forwardLength};
    let right={x:-forward.z,y:0,z:forward.x},rightLength=Math.hypot(right.x,right.z);
    if(rightLength<1e-6){right={x:1,y:0,z:0};rightLength=1;}
    right={x:right.x/rightLength,y:0,z:right.z/rightLength};
    const up={x:right.y*forward.z-right.z*forward.y,y:right.z*forward.x-right.x*forward.z,z:right.x*forward.y-right.y*forward.x};
    return{position,target,forward,right,up,distance};
  }

  boundsCorners(bounds){const corners=[];for(const x of [bounds.minX,bounds.maxX])for(const y of [bounds.minY,bounds.maxY])for(const z of [bounds.minZ,bounds.maxZ])corners.push({x,y,z});return corners;}

  fitDistanceForBounds(bounds,target=this.boundsCenter(bounds),margin=1.14){
    const frame=this.frameFor(target,1),vertical=Math.tan(this.camera.fov/2)/margin,horizontal=vertical*Math.max(.35,(this.w||960)/(this.h||560));let required=this.camera.near+1;
    for(const point of this.boundsCorners(bounds)){
      const rel={x:point.x-target.x,y:point.y-target.y,z:point.z-target.z},cx=rel.x*frame.right.x+rel.y*frame.right.y+rel.z*frame.right.z,cy=rel.x*frame.up.x+rel.y*frame.up.y+rel.z*frame.up.z,cz=rel.x*frame.forward.x+rel.y*frame.forward.y+rel.z*frame.forward.z;
      required=Math.max(required,Math.abs(cx)/horizontal-cz,Math.abs(cy)/vertical-cz,this.camera.near-cz+1);
    }
    return required;
  }

  zoomLimits(){
    if(this.viewMode==='2d')return{min:.35,max:10};
    const bounds=this.sceneBounds3D(),target=this.camera.target||this.boundsCenter(bounds),fit=Math.max(1,this.camera.fitDistance||this.fitDistanceForBounds(bounds,target,1.14)),frame=this.frameFor(target,1);let nearest=0;
    for(const point of this.boundsCorners(bounds)){const rel={x:point.x-target.x,y:point.y-target.y,z:point.z-target.z};nearest=Math.min(nearest,rel.x*frame.forward.x+rel.y*frame.forward.y+rel.z*frame.forward.z);}
    const minimumDistance=Math.max(this.camera.near*4,-nearest+this.camera.near*4);
    return{min:.5,max:Math.max(1.2,Math.min(5.5,fit/minimumDistance))};
  }
  clampZoom(value){const limits=this.zoomLimits();return clamp(value,limits.min,limits.max);}

  updateCameraPose(){
    const target=this.camera.target||this.boundsCenter(this.sceneBounds3D()),fit=Math.max(1,this.camera.fitDistance||this.fitDistanceForBounds(this.sceneBounds3D(),target,1.14)),zoom=this.clampZoom(this.camera.zoom||1),frame=this.frameFor(target,fit/zoom);
    this.camera.zoom=zoom;this.camera.target={...target};this.camera.position={...frame.position};this.camera.up={...frame.up};
    return frame;
  }

  basis(){const frame=this.updateCameraPose();return{right:frame.right,up:frame.up,depth:frame.forward,forward:frame.forward,position:frame.position,target:frame.target};}

  cameraPoint(point,frame=this.activeFrame||this.updateCameraPose()){
    const d={x:point.x-frame.position.x,y:point.y-frame.position.y,z:point.z-frame.position.z};
    return{x:d.x*frame.right.x+d.y*frame.right.y+d.z*frame.right.z,y:d.x*frame.up.x+d.y*frame.up.y+d.z*frame.up.z,z:d.x*frame.forward.x+d.y*frame.forward.y+d.z*frame.forward.z};
  }

  projectCameraPoint(point){
    const depth=Math.max(this.camera.near,point.z),focal=(this.h||560)/(2*Math.tan(this.camera.fov/2)),scale=focal/depth;
    return{x:(this.w||960)/2+point.x*scale+this.camera.panX,y:(this.h||560)/2-point.y*scale+this.camera.panY,depth:point.z,scale,visible:point.z>=this.camera.near};
  }

  project3D(point){return this.projectCameraPoint(this.cameraPoint(point));}

  clippedCameraPolygon(source){
    const near=this.camera.near;let output=[];
    for(let i=0;i<source.length;i++){
      const current=source[i],previous=source[(i+source.length-1)%source.length],currentInside=current.z>=near,previousInside=previous.z>=near;
      if(currentInside!==previousInside){const ratio=(near-previous.z)/(current.z-previous.z);output.push({x:lerp(previous.x,current.x,ratio),y:lerp(previous.y,current.y,ratio),z:near});}
      if(currentInside)output.push(current);
    }
    return output;
  }

  clippedPolygon(points){const frame=this.activeFrame||this.updateCameraPose();return this.clippedCameraPolygon(points.map(point=>this.cameraPoint(point,frame)));}

  paintCameraPolygon(cameraPoints,fill,stroke=null,width=.7){
    const clipped=this.clippedCameraPolygon(cameraPoints);if(clipped.length<3)return;const c=this.ctx,projected=clipped.map(point=>this.projectCameraPoint(point));c.beginPath();c.moveTo(projected[0].x,projected[0].y);for(let i=1;i<projected.length;i++)c.lineTo(projected[i].x,projected[i].y);c.closePath();if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}
  }

  poly(points,fill,stroke=null,width=.7){
    const frame=this.activeFrame||this.updateCameraPose(),cameraPoints=points.map(point=>this.cameraPoint(point,frame));
    if(this.collectFaces){const depth=cameraPoints.reduce((sum,point)=>sum+point.z,0)/cameraPoints.length;this.faceQueue.push({cameraPoints,fill,stroke,width,depth});return;}
    this.paintCameraPolygon(cameraPoints,fill,stroke,width);
  }

  flushFaces(){
    this.collectFaces=false;
    this.faceQueue.sort((a,b)=>b.depth-a.depth);
    for(const face of this.faceQueue)this.paintCameraPolygon(face.cameraPoints,face.fill,face.stroke,face.width);
    this.faceQueue.length=0;
  }

  boxFaces(x1,x2,y1,y2,z1,z2){return[
    [{x:x1,y:y1,z:z1},{x:x2,y:y1,z:z1},{x:x2,y:y2,z:z1},{x:x1,y:y2,z:z1}],
    [{x:x1,y:y1,z:z2},{x:x1,y:y2,z:z2},{x:x2,y:y2,z:z2},{x:x2,y:y1,z:z2}],
    [{x:x1,y:y1,z:z1},{x:x1,y:y1,z:z2},{x:x2,y:y1,z:z2},{x:x2,y:y1,z:z1}],
    [{x:x1,y:y2,z:z1},{x:x2,y:y2,z:z1},{x:x2,y:y2,z:z2},{x:x1,y:y2,z:z2}],
    [{x:x1,y:y1,z:z1},{x:x1,y:y2,z:z1},{x:x1,y:y2,z:z2},{x:x1,y:y1,z:z2}],
    [{x:x2,y:y1,z:z1},{x:x2,y:y1,z:z2},{x:x2,y:y2,z:z2},{x:x2,y:y2,z:z1}]
  ];}

  drawBox(x1,x2,y1,y2,z1,z2,colors={top:'#68777e',side:'#3f4e55',front:'#849299'},stroke='rgba(15,25,30,.55)'){
    const faces=this.boxFaces(x1,x2,y1,y2,z1,z2);for(let i=0;i<faces.length;i++)this.poly(faces[i],i<2?colors.top:i<4?colors.side:colors.front,stroke,.65);
  }

  radialBoxFaces(x1,x2,centerR,radialSize,tangentSize,theta,origin={y:0,z:0}){
    const rv={y:Math.cos(theta),z:Math.sin(theta)},tv={y:-Math.sin(theta),z:Math.cos(theta)},corners=[];
    for(const x of [x1,x2])for(const r of [-radialSize/2,radialSize/2])for(const t of [-tangentSize/2,tangentSize/2])corners.push({x,y:origin.y+rv.y*(centerR+r)+tv.y*t,z:origin.z+rv.z*(centerR+r)+tv.z*t});
    const idx=(xi,ri,ti)=>xi*4+ri*2+ti;
    return[
      [corners[idx(0,0,0)],corners[idx(1,0,0)],corners[idx(1,1,0)],corners[idx(0,1,0)]],
      [corners[idx(0,0,1)],corners[idx(0,1,1)],corners[idx(1,1,1)],corners[idx(1,0,1)]],
      [corners[idx(0,0,0)],corners[idx(0,0,1)],corners[idx(1,0,1)],corners[idx(1,0,0)]],
      [corners[idx(0,1,0)],corners[idx(1,1,0)],corners[idx(1,1,1)],corners[idx(0,1,1)]],
      [corners[idx(0,0,0)],corners[idx(0,1,0)],corners[idx(0,1,1)],corners[idx(0,0,1)]],
      [corners[idx(1,0,0)],corners[idx(1,0,1)],corners[idx(1,1,1)],corners[idx(1,1,0)]]
    ];
  }

  drawRadialBox(x1,x2,centerR,radialSize,tangentSize,theta,colors,origin){
    const faces=this.radialBoxFaces(x1,x2,centerR,radialSize,tangentSize,theta,origin);for(let i=0;i<faces.length;i++)this.poly(faces[i],i<2?colors.top:i<4?colors.side:colors.front,'rgba(12,20,24,.65)',.65);
  }

  draw3D(){
    this.drawBackground(true);
    this.activeFrame=this.updateCameraPose();
    this.faceQueue=[];this.collectFaces=true;
    this.drawMachineBed3D();
    this.drawWorkpiece3D();
    if(this.showTable)this.drawChuck3D();
    if(this.showTurret)this.drawTurret3D();
    this.drawTool3D();
    this.flushFaces();
    this.drawMachiningHighlights3D();
    this.drawThread3D();
    this.drawPath3D();
    if(this.showCollisions)this.drawCollisions3D();
    this.drawAxis3D();
    this.activeFrame=null;
  }

  drawMachineBed3D(){
    const face=this.chuckFaceZ(),d=this.cfg.diameter;
    const shadowA=this.project3D({x:face-this.cfg.chuckLength-20,y:-d*.25,z:-d*.92}),shadowB=this.project3D({x:55,y:d*1.35,z:-d*.92});
    const c=this.ctx,g=c.createRadialGradient((shadowA.x+shadowB.x)/2,(shadowA.y+shadowB.y)/2,5,(shadowA.x+shadowB.x)/2,(shadowA.y+shadowB.y)/2,Math.max(80,Math.abs(shadowB.x-shadowA.x)));g.addColorStop(0,'rgba(0,0,0,.34)');g.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=g;c.beginPath();c.ellipse((shadowA.x+shadowB.x)/2,(shadowA.y+shadowB.y)/2,Math.max(80,Math.abs(shadowB.x-shadowA.x)*.55),Math.max(20,Math.abs(shadowB.y-shadowA.y)*.45),0,0,TAU);c.fill();
    this.drawBox(face-this.cfg.chuckLength-35,55,-d*1.7,d*1.7,-d*1.34,-d*1.04,{top:'#41545e',side:'#253640',front:'#596c76'},'rgba(102,137,153,.36)');
    this.drawBox(face-this.cfg.chuckLength-15,45,-d*1.35,-d*.9,-d*1.02,-d*.91,{top:'#768991',side:'#344750',front:'#8fa0a7'},'rgba(13,26,32,.7)');
    this.drawBox(face-this.cfg.chuckLength-15,45,d*.9,d*1.35,-d*1.02,-d*.91,{top:'#768991',side:'#344750',front:'#8fa0a7'},'rgba(13,26,32,.7)');
  }

  drawWorkpiece3D(){
    const q=this.quality(),rings=q.rings,step=q.step,visible=this.exposedCount();
    for(let i=0;i<visible-1;i+=step){
      const i2=Math.min(visible-1,i+step),z1=-i*this.cfg.resolution,z2=-i2*this.cfg.resolution,r1=this.profile[i],r2=this.profile[i2];
      for(let a=0;a<rings;a++){
        const t1=a/rings*TAU,t2=(a+1)/rings*TAU,pts=[{x:z1,y:r1*Math.cos(t1),z:r1*Math.sin(t1)},{x:z2,y:r2*Math.cos(t1),z:r2*Math.sin(t1)},{x:z2,y:r2*Math.cos(t2),z:r2*Math.sin(t2)},{x:z1,y:r1*Math.cos(t2),z:r1*Math.sin(t2)}],mid=(t1+t2)/2,normalLight=.56+.30*Math.max(0,Math.cos(mid-.55))+.12*Math.max(0,Math.sin(mid+.4)),cutRatio=clamp(1-r1/(this.cfg.diameter/2),0,1),base={r:205,g:153,b:41},color=`rgb(${Math.round(base.r*normalLight+39-cutRatio*18)},${Math.round(base.g*normalLight+31-cutRatio*14)},${Math.round(base.b*normalLight+15)})`;this.poly(pts,color,null,.45);
      }
    }
    this.drawFrontFace3D();
  }

  drawFrontFace3D(){
    const rings=this.quality().rings,outer=this.profile[0],inner=this.innerProfile[0];
    for(let a=0;a<rings;a++){
      const t1=a/rings*TAU,t2=(a+1)/rings*TAU,pts=[{x:.12,y:inner*Math.cos(t1),z:inner*Math.sin(t1)},{x:.12,y:outer*Math.cos(t1),z:outer*Math.sin(t1)},{x:.12,y:outer*Math.cos(t2),z:outer*Math.sin(t2)},{x:.12,y:inner*Math.cos(t2),z:inner*Math.sin(t2)}],light=.78+.18*Math.max(0,Math.cos((t1+t2)/2-.5));this.poly(pts,`rgb(${Math.round(221*light)},${Math.round(172*light)},${Math.round(62*light)})`,'rgba(80,52,10,.22)',.55);
    }
    if(inner>0){
      const len=Math.min(this.cfg.stickout,18);
      for(let a=0;a<rings;a++){const t1=a/rings*TAU,t2=(a+1)/rings*TAU,pts=[{x:0,y:inner*Math.cos(t1),z:inner*Math.sin(t1)},{x:-len,y:inner*Math.cos(t1),z:inner*Math.sin(t1)},{x:-len,y:inner*Math.cos(t2),z:inner*Math.sin(t2)},{x:0,y:inner*Math.cos(t2),z:inner*Math.sin(t2)}];this.poly(pts,'#40331d','rgba(20,15,8,.5)',.5);}
    }
  }

  drawMachiningHighlights3D(){
    const c=this.ctx,visible=this.exposedCount(),step=Math.max(3,Math.round(7/this.cfg.resolution));c.strokeStyle='rgba(255,224,139,.12)';c.lineWidth=.8;
    for(let i=step;i<visible;i+=step){const z=-i*this.cfg.resolution,r=this.profile[i],a=this.project3D({x:z,y:r,z:0}),b=this.project3D({x:z,y:-r,z:0});c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();}
  }

  drawChuck3D(){
    const q=this.quality(),rings=q.rings,face=this.chuckFaceZ(),back=face-this.cfg.chuckLength,r=Math.max(this.cfg.diameter*.72,34);
    for(let a=0;a<rings;a++){
      const t1=a/rings*TAU,t2=(a+1)/rings*TAU,pts=[{x:face,y:r*Math.cos(t1),z:r*Math.sin(t1)},{x:back,y:r*Math.cos(t1),z:r*Math.sin(t1)},{x:back,y:r*Math.cos(t2),z:r*Math.sin(t2)},{x:face,y:r*Math.cos(t2),z:r*Math.sin(t2)}],light=.52+.32*Math.max(0,Math.cos((t1+t2)/2-.5));this.poly(pts,`rgb(${Math.round(118*light+38)},${Math.round(132*light+40)},${Math.round(139*light+42)})`,'rgba(20,30,35,.48)',.6);
    }
    const hubR=r*.34;
    for(let a=0;a<rings;a++){
      const t1=a/rings*TAU,t2=(a+1)/rings*TAU;this.poly([{x:face+.15,y:hubR*Math.cos(t1),z:hubR*Math.sin(t1)},{x:face+.15,y:r*Math.cos(t1),z:r*Math.sin(t1)},{x:face+.15,y:r*Math.cos(t2),z:r*Math.sin(t2)},{x:face+.15,y:hubR*Math.cos(t2),z:hubR*Math.sin(t2)}],'#68777e','rgba(20,29,34,.55)',.55);
    }
    const barR=this.cfg.diameter/2,jawOuter=r*.92,jawCenter=(barR+jawOuter)/2,jawRadial=Math.max(8,jawOuter-barR),jawTangential=Math.max(11,r*.24);
    for(let k=0;k<3;k++){
      const theta=k*TAU/3;
      this.drawRadialBox(face-4,face+9,jawCenter,jawRadial,jawTangential,theta,{top:'#9ca9ae',side:'#46535a',front:'#bcc5c8'});
      this.drawRadialBox(face+7,face+15,barR+jawRadial*.24,jawRadial*.48,jawTangential*.7,theta,{top:'#76858c',side:'#36434a',front:'#9ba7ac'});
    }
    this.drawSpindleNose3D(back,r);
  }

  drawSpindleNose3D(back,r){
    this.drawBox(back-24,back,-r*.92,r*.92,-r*.92,r*.92,{top:'#34434a',side:'#202e35',front:'#526068'},'rgba(12,20,24,.65)');
  }

  drawPath3D(){
    const c=this.ctx;for(let i=0;i<this.path.length;i++){const s=this.path[i];if(s.kind!=='move'||(s.type==='G00'&&!this.showRapids)||(s.type!=='G00'&&!this.showCuts))continue;const a=this.project3D({x:s.from.z,y:s.from.x/2,z:0}),b=this.project3D({x:s.to.z,y:s.to.x/2,z:0}),done=i<=this.current;c.strokeStyle=done?(s.type==='G00'?'rgba(76,202,255,.85)':'rgba(65,255,159,.95)'):(s.type==='G00'?'rgba(76,202,255,.25)':'rgba(220,245,235,.28)');c.setLineDash(s.type==='G00'?[6,5]:[]);c.lineWidth=i===this.current?3:1.3;c.lineCap='round';c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();}c.setLineDash([]);c.lineCap='butt';
  }

  drawThread3D(){
    if(!this.threadSegments.length)return;
    const c=this.ctx;for(const s of this.threadSegments){const pitch=Math.max(.2,s.threadPitch||1),turns=Math.max(1,Math.abs(s.to.z-s.from.z)/pitch),samples=Math.ceil(turns*24),radius=Math.abs(s.to.x)/2+.12;c.strokeStyle='rgba(255,211,105,.78)';c.lineWidth=1;c.beginPath();for(let i=0;i<=samples;i++){const t=i/samples,z=lerp(s.from.z,s.to.z,t),a=t*turns*TAU,p=this.project3D({x:z,y:radius*Math.cos(a),z:radius*Math.sin(a)});i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);}c.stroke();}
  }

  turretWorldLayout(){
    const l=this.toolLayout(),center=l.turret,radius=Math.max(25,this.cfg.diameter*.42),thickness=Math.max(16,this.cfg.diameter*.22);return{...l,center,radius,thickness};
  }

  drawTurret3D(){
    const l=this.turretWorldLayout(),{center,radius,thickness}=l,faces=[];
    for(let a=0;a<8;a++){
      const t1=this.turretAngle+a/8*TAU-Math.PI/8,t2=this.turretAngle+(a+1)/8*TAU-Math.PI/8,pts=[{x:center.x-thickness/2,y:center.y+radius*Math.cos(t1),z:center.z+radius*Math.sin(t1)},{x:center.x+thickness/2,y:center.y+radius*Math.cos(t1),z:center.z+radius*Math.sin(t1)},{x:center.x+thickness/2,y:center.y+radius*Math.cos(t2),z:center.z+radius*Math.sin(t2)},{x:center.x-thickness/2,y:center.y+radius*Math.cos(t2),z:center.z+radius*Math.sin(t2)}];faces.push({pts,depth:pts.reduce((s,p)=>s+this.project3D(p).depth,0)/4,color:a%2?'#46565e':'#52636b'});
    }
    const front=[],back=[];for(let a=0;a<8;a++){const t=this.turretAngle+a/8*TAU-Math.PI/8;front.push({x:center.x+thickness/2,y:center.y+radius*Math.cos(t),z:center.z+radius*Math.sin(t)});back.push({x:center.x-thickness/2,y:center.y+radius*Math.cos(t),z:center.z+radius*Math.sin(t)});}faces.push({pts:front,depth:front.reduce((s,p)=>s+this.project3D(p).depth,0)/8,color:'#697980'});faces.push({pts:back,depth:back.reduce((s,p)=>s+this.project3D(p).depth,0)/8,color:'#303f47'});faces.sort((a,b)=>b.depth-a.depth);for(const f of faces)this.poly(f.pts,f.color,'rgba(15,24,28,.68)',.8);
    for(let i=0;i<8;i++){
      const angle=this.turretAngle+i/8*TAU,active=i===(this.activeToolNumber-1+8)%8,colors=active?{top:'#ffe05a',side:'#9f7d12',front:'#fff09a'}:{top:'#b0bdc2',side:'#596970',front:'#d6dfe2'};
      this.drawRadialBox(center.x+thickness/2+.4,center.x+thickness/2+3.2,radius*.68,4.4,7.2,angle,colors,{y:center.y,z:center.z});
    }
    this.drawCrossSlide3D(l);
  }

  drawCrossSlide3D(l){
    const c=l.center,d=this.cfg.diameter;
    this.drawBox(c.x-30,c.x+44,c.y-20,c.y+28,-d*.92,-d*.56,{top:'#687981',side:'#34464f',front:'#87969c'},'rgba(12,22,27,.68)');
    this.drawBox(c.x-42,c.x+55,c.y-10,c.y+12,-d*.55,-d*.42,{top:'#819198',side:'#43545c',front:'#9eaaae'},'rgba(12,22,27,.7)');
  }

  segmentPrismFaces(start,end,width,depth=width){
    const direction={x:end.x-start.x,y:end.y-start.y,z:end.z-start.z},length=Math.hypot(direction.x,direction.y,direction.z)||1;direction.x/=length;direction.y/=length;direction.z/=length;
    const reference=Math.abs(direction.y)<.86?{x:0,y:1,z:0}:{x:0,y:0,z:1},sideRaw={x:direction.y*reference.z-direction.z*reference.y,y:direction.z*reference.x-direction.x*reference.z,z:direction.x*reference.y-direction.y*reference.x},sideLength=Math.hypot(sideRaw.x,sideRaw.y,sideRaw.z)||1,side={x:sideRaw.x/sideLength,y:sideRaw.y/sideLength,z:sideRaw.z/sideLength},up={x:side.y*direction.z-side.z*direction.y,y:side.z*direction.x-side.x*direction.z,z:side.x*direction.y-side.y*direction.x};
    const points=[];for(const origin of [start,end])for(const sideSign of [-1,1])for(const upSign of [-1,1])points.push({x:origin.x+side.x*sideSign*width/2+up.x*upSign*depth/2,y:origin.y+side.y*sideSign*width/2+up.y*upSign*depth/2,z:origin.z+side.z*sideSign*width/2+up.z*upSign*depth/2});
    const at=(endIndex,sideIndex,upIndex)=>points[endIndex*4+sideIndex*2+upIndex];
    return[[at(0,0,0),at(0,1,0),at(0,1,1),at(0,0,1)],[at(1,0,0),at(1,0,1),at(1,1,1),at(1,1,0)],[at(0,0,0),at(1,0,0),at(1,0,1),at(0,0,1)],[at(0,1,0),at(0,1,1),at(1,1,1),at(1,1,0)],[at(0,0,0),at(0,1,0),at(1,1,0),at(1,0,0)],[at(0,0,1),at(1,0,1),at(1,1,1),at(0,1,1)]];
  }

  drawPrism(start,end,width,depth,colors){
    const faces=this.segmentPrismFaces(start,end,width,depth);
    for(let i=0;i<faces.length;i++)this.poly(faces[i],i<2?colors.front:i<4?colors.side:colors.top,'rgba(18,28,33,.78)',.65);
  }

  drawTool3D(){
    const layout=this.toolLayout(),width=Math.max(5,layout.holderWidth*1.28),vector={x:layout.back.x-layout.tip.x,y:layout.back.y-layout.tip.y,z:layout.back.z-layout.tip.z},length=Math.hypot(vector.x,vector.y,vector.z)||1,direction={x:vector.x/length,y:vector.y/length,z:vector.z/length},insertLength=Math.max(5,width*1.15),insertEnd={x:layout.tip.x+direction.x*insertLength,y:layout.tip.y+direction.y*insertLength,z:layout.tip.z+direction.z*insertLength};
    this.drawPrism(insertEnd,layout.back,width,width*.78,{top:'#c8d3d7',side:'#53656d',front:'#81949c'});
    const insertColor=layout.type==='thread'?{top:'#f4a64a',side:'#8a4f18',front:'#ffd08a'}:layout.type==='groove'?{top:'#71d0de',side:'#286b76',front:'#b5f3fa'}:layout.type==='drill'?{top:'#dce4e8',side:'#647780',front:'#f5fafc'}:{top:'#ffd21f',side:'#8f7110',front:'#ffea76'};
    this.drawPrism(layout.tip,insertEnd,width*1.08,width*.9,insertColor);
  }

  drawCollisions3D(){
    const c=this.ctx;for(const marker of this.collisionMarkers){const p=this.project3D({x:marker.point.z,y:marker.point.x/2,z:0});c.strokeStyle='#ff4157';c.fillStyle='rgba(255,65,87,.16)';c.lineWidth=2;c.beginPath();c.arc(p.x,p.y,8,0,TAU);c.fill();c.stroke();c.beginPath();c.moveTo(p.x-5,p.y-5);c.lineTo(p.x+5,p.y+5);c.moveTo(p.x+5,p.y-5);c.lineTo(p.x-5,p.y+5);c.stroke();}
  }

  drawAxis3D(){
    const c=this.ctx,a=this.project3D({x:this.chuckFaceZ()-this.cfg.chuckLength-22,y:0,z:0}),b=this.project3D({x:30,y:0,z:0});c.strokeStyle='rgba(106,205,241,.75)';c.setLineDash([7,5]);c.lineWidth=1.2;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();c.setLineDash([]);c.fillStyle='#76d3f5';c.font='700 11px system-ui';c.fillText('Z',b.x+5,b.y-4);
  }
}
