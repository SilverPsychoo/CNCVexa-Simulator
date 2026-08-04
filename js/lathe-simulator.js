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
    this.camera={yaw:-35*Math.PI/180,pitch:22*Math.PI/180,zoom:1,panX:0,panY:0};
    this.drag=null;
    this.resizeObserver=new ResizeObserver(()=>this.resize());
    this.resizeObserver.observe(canvas);
    this.bindControls();
    this.configure({units:'mm',diameter:60,length:120,bore:0,stickout:100,chuckLength:30,resolution:1,renderQuality:'high'});
  }

  setActive(value=true){this.active=!!value;if(this.active)this.resize();}
  setDisplayMode(mode='3d'){this.viewMode=mode==='2d'?'2d':'3d';this.draw();}
  setRenderQuality(level='high'){this.renderQuality=['low','medium','high','ultra'].includes(level)?level:'high';this.draw();}
  getCamera(){return {...this.camera,viewMode:this.viewMode};}
  setCamera(camera={}){Object.assign(this.camera,camera);if(camera.viewMode)this.viewMode=camera.viewMode;this.draw();}
  setCurrentTool(tool={}){this.currentTool={...this.currentTool,...tool};this.draw();}

  bindControls(){
    this.canvas.addEventListener('contextmenu',e=>{if(this.active)e.preventDefault();});
    this.canvas.addEventListener('pointerdown',e=>{
      if(!this.active||this.viewMode==='2d')return;
      this.canvas.setPointerCapture(e.pointerId);
      this.drag={x:e.clientX,y:e.clientY,mode:e.button===2||e.shiftKey?'pan':'rotate'};
      this.canvas.classList.add('dragging');
    });
    this.canvas.addEventListener('pointermove',e=>{
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
    const release=()=>{this.drag=null;this.canvas.classList.remove('dragging');};
    this.canvas.addEventListener('pointerup',release);
    this.canvas.addEventListener('pointercancel',release);
    this.canvas.addEventListener('wheel',e=>{
      if(!this.active)return;
      e.preventDefault();
      this.camera.zoom=clamp(this.camera.zoom*Math.exp(-e.deltaY*.0012),.25,8);
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
  fitView(redraw=true){this.camera.zoom=1;this.camera.panX=0;this.camera.panY=0;if(redraw)this.draw();}

  applyStep(step){
    if(!step)return;
    this.current++;
    if(step.kind==='toolchange'){
      this.activeToolNumber=step.toTool||step.tool||0;
      this.activeOffset=step.offset||this.activeToolNumber;
      this.currentTool={...this.currentTool,type:step.toolType||this.currentTool.type,name:step.toolName||this.currentTool.name,noseRadius:step.noseRadius??this.currentTool.noseRadius,insertWidth:step.insertWidth||this.currentTool.insertWidth,orientation:step.orientation||this.currentTool.orientation};
      this.animateTurretTo(this.activeToolNumber);
      this.draw();
      return;
    }
    if(step.kind!=='move')return;
    this.toolPos={...step.to};
    this.activeToolNumber=step.tool||this.activeToolNumber;
    this.activeOffset=step.offset||this.activeOffset;
    this.currentTool={...this.currentTool,type:step.toolType||this.currentTool.type,name:step.toolName||this.currentTool.name,noseRadius:step.noseRadius??this.currentTool.noseRadius,insertWidth:step.insertWidth||this.currentTool.insertWidth,orientation:step.orientation||this.currentTool.orientation};
    if(step.cut)this.cutSegment(step.from,step.to,this.currentTool);
    if(step.cycle==='G76'&&step.thread)this.threadSegments.push({...step});
    if(step.collisions?.length)this.collisionMarkers.push({point:{...step.to},line:step.line,issues:step.collisions});
    this.draw();
  }

  animateTurretTo(toolNumber){
    const stations=8,index=(Math.max(1,toolNumber)-1)%stations;
    this.turretTargetAngle=Math.PI-index/stations*TAU;
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
    this.w=r.width;this.h=r.height;
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
    c.fillStyle='#1b3441';c.font='700 12px system-ui';c.fillText('Perfil X–Z · X programado en diámetro',18,24);c.font='10px system-ui';c.fillStyle='#5f7f8d';c.fillText('Z0 = cara frontal · el plato sujeta la barra en Z negativo',18,41);
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

  basis(){const {yaw,pitch}=this.camera,cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);return{right:{x:cy,y:0,z:-sy},up:{x:sy*sp,y:cp,z:cy*sp},depth:{x:sy*cp,y:-sp,z:cy*cp}};}
  project3D(p){const face=this.chuckFaceZ(),center={x:(face+0)/2-8,y:0,z:-4},d={x:p.x-center.x,y:p.y,z:p.z},b=this.basis(),sceneLength=this.cfg.stickout+this.cfg.chuckLength+this.cfg.diameter*2.6,scale=Math.min(this.w/sceneLength,this.h/(this.cfg.diameter*2.7))*this.camera.zoom;return{x:this.w/2+(d.x*b.right.x+d.y*b.right.y+d.z*b.right.z)*scale+this.camera.panX,y:this.h/2-(d.x*b.up.x+d.y*b.up.y+d.z*b.up.z)*scale+this.camera.panY,depth:d.x*b.depth.x+d.y*b.depth.y+d.z*b.depth.z,scale};}

  poly(points,fill,stroke=null,width=.7){const c=this.ctx,p=points.map(q=>this.project3D(q));c.beginPath();c.moveTo(p[0].x,p[0].y);for(let i=1;i<p.length;i++)c.lineTo(p[i].x,p[i].y);c.closePath();if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}}

  boxFaces(x1,x2,y1,y2,z1,z2){return[
    [{x:x1,y:y1,z:z1},{x:x2,y:y1,z:z1},{x:x2,y:y2,z:z1},{x:x1,y:y2,z:z1}],
    [{x:x1,y:y1,z:z2},{x:x1,y:y2,z:z2},{x:x2,y:y2,z:z2},{x:x2,y:y1,z:z2}],
    [{x:x1,y:y1,z:z1},{x:x1,y:y1,z:z2},{x:x2,y:y1,z:z2},{x:x2,y:y1,z:z1}],
    [{x:x1,y:y2,z:z1},{x:x2,y:y2,z:z1},{x:x2,y:y2,z:z2},{x:x1,y:y2,z:z2}],
    [{x:x1,y:y1,z:z1},{x:x1,y:y2,z:z1},{x:x1,y:y2,z:z2},{x:x1,y:y1,z:z2}],
    [{x:x2,y:y1,z:z1},{x:x2,y:y1,z:z2},{x:x2,y:y2,z:z2},{x:x2,y:y2,z:z1}]
  ];}

  drawBox(x1,x2,y1,y2,z1,z2,colors={top:'#68777e',side:'#3f4e55',front:'#849299'},stroke='rgba(15,25,30,.55)'){
    const faces=this.boxFaces(x1,x2,y1,y2,z1,z2).map((pts,i)=>({pts,depth:pts.reduce((s,p)=>s+this.project3D(p).depth,0)/4,color:i<2?colors.top:i<4?colors.side:colors.front}));
    faces.sort((a,b)=>a.depth-b.depth);for(const f of faces)this.poly(f.pts,f.color,stroke,.65);
  }

  radialBoxFaces(x1,x2,centerR,radialSize,tangentSize,theta){
    const rv={y:Math.cos(theta),z:Math.sin(theta)},tv={y:-Math.sin(theta),z:Math.cos(theta)},corners=[];
    for(const x of [x1,x2])for(const r of [-radialSize/2,radialSize/2])for(const t of [-tangentSize/2,tangentSize/2])corners.push({x,y:rv.y*(centerR+r)+tv.y*t,z:rv.z*(centerR+r)+tv.z*t});
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

  drawRadialBox(x1,x2,centerR,radialSize,tangentSize,theta,colors){
    const faces=this.radialBoxFaces(x1,x2,centerR,radialSize,tangentSize,theta).map((pts,i)=>({pts,depth:pts.reduce((s,p)=>s+this.project3D(p).depth,0)/4,color:i<2?colors.top:i<4?colors.side:colors.front}));faces.sort((a,b)=>a.depth-b.depth);for(const f of faces)this.poly(f.pts,f.color,'rgba(12,20,24,.65)',.65);
  }

  draw3D(){
    this.drawBackground(true);
    this.drawMachineBed3D();
    this.drawWorkpiece3D();
    if(this.showTable)this.drawChuck3D();
    this.drawThread3D();
    this.drawPath3D();
    if(this.showTurret)this.drawTurret3D();
    this.drawTool3D();
    if(this.showCollisions)this.drawCollisions3D();
    this.drawAxis3D();
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
    const q=this.quality(),rings=q.rings,step=q.step,visible=this.exposedCount(),faces=[];
    for(let i=0;i<visible-1;i+=step){
      const i2=Math.min(visible-1,i+step),z1=-i*this.cfg.resolution,z2=-i2*this.cfg.resolution,r1=this.profile[i],r2=this.profile[i2];
      for(let a=0;a<rings;a++){
        const t1=a/rings*TAU,t2=(a+1)/rings*TAU,pts=[{x:z1,y:r1*Math.cos(t1),z:r1*Math.sin(t1)},{x:z2,y:r2*Math.cos(t1),z:r2*Math.sin(t1)},{x:z2,y:r2*Math.cos(t2),z:r2*Math.sin(t2)},{x:z1,y:r1*Math.cos(t2),z:r1*Math.sin(t2)}],mid=(t1+t2)/2,normalLight=.56+.30*Math.max(0,Math.cos(mid-.55))+.12*Math.max(0,Math.sin(mid+.4)),cutRatio=clamp(1-r1/(this.cfg.diameter/2),0,1),base={r:205,g:153,b:41},color=`rgb(${Math.round(base.r*normalLight+39-cutRatio*18)},${Math.round(base.g*normalLight+31-cutRatio*14)},${Math.round(base.b*normalLight+15)})`,depth=pts.reduce((s,p)=>s+this.project3D(p).depth,0)/4;faces.push({pts,color,depth});
      }
    }
    faces.sort((a,b)=>a.depth-b.depth);for(const f of faces)this.poly(f.pts,f.color,this.renderQuality==='ultra'?'rgba(95,61,12,.08)':null,.45);
    this.drawFrontFace3D();
    this.drawMachiningHighlights3D();
  }

  drawFrontFace3D(){
    const rings=this.quality().rings,outer=this.profile[0],inner=this.innerProfile[0],faces=[];
    for(let a=0;a<rings;a++){
      const t1=a/rings*TAU,t2=(a+1)/rings*TAU,pts=[{x:.12,y:inner*Math.cos(t1),z:inner*Math.sin(t1)},{x:.12,y:outer*Math.cos(t1),z:outer*Math.sin(t1)},{x:.12,y:outer*Math.cos(t2),z:outer*Math.sin(t2)},{x:.12,y:inner*Math.cos(t2),z:inner*Math.sin(t2)}],light=.78+.18*Math.max(0,Math.cos((t1+t2)/2-.5));faces.push({pts,depth:pts.reduce((s,p)=>s+this.project3D(p).depth,0)/4,color:`rgb(${Math.round(221*light)},${Math.round(172*light)},${Math.round(62*light)})`});
    }
    faces.sort((a,b)=>a.depth-b.depth);for(const f of faces)this.poly(f.pts,f.color,'rgba(80,52,10,.22)',.55);
    if(inner>0){
      const len=Math.min(this.cfg.stickout,18),boreFaces=[];
      for(let a=0;a<rings;a++){const t1=a/rings*TAU,t2=(a+1)/rings*TAU,pts=[{x:0,y:inner*Math.cos(t1),z:inner*Math.sin(t1)},{x:-len,y:inner*Math.cos(t1),z:inner*Math.sin(t1)},{x:-len,y:inner*Math.cos(t2),z:inner*Math.sin(t2)},{x:0,y:inner*Math.cos(t2),z:inner*Math.sin(t2)}];boreFaces.push({pts,depth:pts.reduce((s,p)=>s+this.project3D(p).depth,0)/4});}
      boreFaces.sort((a,b)=>a.depth-b.depth);for(const f of boreFaces)this.poly(f.pts,'#40331d','rgba(20,15,8,.5)',.5);
    }
  }

  drawMachiningHighlights3D(){
    const c=this.ctx,visible=this.exposedCount(),step=Math.max(3,Math.round(7/this.cfg.resolution));c.strokeStyle='rgba(255,224,139,.12)';c.lineWidth=.8;
    for(let i=step;i<visible;i+=step){const z=-i*this.cfg.resolution,r=this.profile[i],a=this.project3D({x:z,y:r,z:0}),b=this.project3D({x:z,y:-r,z:0});c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();}
  }

  drawChuck3D(){
    const q=this.quality(),rings=q.rings,face=this.chuckFaceZ(),back=face-this.cfg.chuckLength,r=Math.max(this.cfg.diameter*.72,34),faces=[];
    for(let a=0;a<rings;a++){
      const t1=a/rings*TAU,t2=(a+1)/rings*TAU,pts=[{x:face,y:r*Math.cos(t1),z:r*Math.sin(t1)},{x:back,y:r*Math.cos(t1),z:r*Math.sin(t1)},{x:back,y:r*Math.cos(t2),z:r*Math.sin(t2)},{x:face,y:r*Math.cos(t2),z:r*Math.sin(t2)}],light=.52+.32*Math.max(0,Math.cos((t1+t2)/2-.5));faces.push({pts,depth:pts.reduce((s,p)=>s+this.project3D(p).depth,0)/4,color:`rgb(${Math.round(118*light+38)},${Math.round(132*light+40)},${Math.round(139*light+42)})`});
    }
    faces.sort((a,b)=>a.depth-b.depth);for(const f of faces)this.poly(f.pts,f.color,'rgba(20,30,35,.48)',.6);
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
    const front=[],back=[];for(let a=0;a<8;a++){const t=this.turretAngle+a/8*TAU-Math.PI/8;front.push({x:center.x+thickness/2,y:center.y+radius*Math.cos(t),z:center.z+radius*Math.sin(t)});back.push({x:center.x-thickness/2,y:center.y+radius*Math.cos(t),z:center.z+radius*Math.sin(t)});}faces.push({pts:front,depth:front.reduce((s,p)=>s+this.project3D(p).depth,0)/8,color:'#697980'});faces.push({pts:back,depth:back.reduce((s,p)=>s+this.project3D(p).depth,0)/8,color:'#303f47'});faces.sort((a,b)=>a.depth-b.depth);for(const f of faces)this.poly(f.pts,f.color,'rgba(15,24,28,.68)',.8);
    for(let i=0;i<8;i++){
      const a=this.turretAngle+i/8*TAU,station={x:center.x+thickness/2+.8,y:center.y+radius*.68*Math.cos(a),z:center.z+radius*.68*Math.sin(a)},p=this.project3D(station),active=i===(this.activeToolNumber-1+8)%8,r=Math.max(3,p.scale*2.7);const c=this.ctx;c.fillStyle=active?'#ffd21f':'#b0bdc2';c.strokeStyle='#26343a';c.lineWidth=1;c.beginPath();c.arc(p.x,p.y,r,0,TAU);c.fill();c.stroke();
    }
    this.drawCrossSlide3D(l);
  }

  drawCrossSlide3D(l){
    const c=l.center,d=this.cfg.diameter;
    this.drawBox(c.x-30,c.x+44,c.y-20,c.y+28,-d*.92,-d*.56,{top:'#687981',side:'#34464f',front:'#87969c'},'rgba(12,22,27,.68)');
    this.drawBox(c.x-42,c.x+55,c.y-10,c.y+12,-d*.55,-d*.42,{top:'#819198',side:'#43545c',front:'#9eaaae'},'rgba(12,22,27,.7)');
  }

  drawTool3D(){
    const l=this.toolLayout(),tip=this.project3D(l.tip),back=this.project3D(l.back),dx=tip.x-back.x,dy=tip.y-back.y,len=Math.max(1,Math.hypot(dx,dy)),nx=-dy/len,ny=dx/len,w=Math.max(5,l.holderWidth*tip.scale*.6),c=this.ctx;
    c.save();const shadowOffset=4;c.fillStyle='rgba(0,0,0,.28)';c.beginPath();c.moveTo(back.x+nx*w+shadowOffset,back.y+ny*w+shadowOffset);c.lineTo(tip.x+nx*w*.45+shadowOffset,tip.y+ny*w*.45+shadowOffset);c.lineTo(tip.x-nx*w*.45+shadowOffset,tip.y-ny*w*.45+shadowOffset);c.lineTo(back.x-nx*w+shadowOffset,back.y-ny*w+shadowOffset);c.closePath();c.fill();
    const grad=c.createLinearGradient(back.x,back.y,tip.x,tip.y);grad.addColorStop(0,'#485860');grad.addColorStop(.42,'#c8d3d7');grad.addColorStop(.72,'#7e9199');grad.addColorStop(1,'#53656d');c.fillStyle=grad;c.strokeStyle='#25343a';c.lineWidth=1.25;c.beginPath();c.moveTo(back.x+nx*w,back.y+ny*w);c.lineTo(tip.x+nx*w*.45,tip.y+ny*w*.45);c.lineTo(tip.x-nx*w*.45,tip.y-ny*w*.45);c.lineTo(back.x-nx*w,back.y-ny*w);c.closePath();c.fill();c.stroke();
    c.strokeStyle='rgba(255,255,255,.28)';c.lineWidth=.8;c.beginPath();c.moveTo(back.x+nx*w*.55,back.y+ny*w*.55);c.lineTo(tip.x+nx*w*.2,tip.y+ny*w*.2);c.stroke();
    this.drawInsertScreen(tip,Math.max(7,w*1.18),Math.atan2(dy,dx),l.type);c.restore();
  }

  drawCollisions3D(){
    const c=this.ctx;for(const marker of this.collisionMarkers){const p=this.project3D({x:marker.point.z,y:marker.point.x/2,z:0});c.strokeStyle='#ff4157';c.fillStyle='rgba(255,65,87,.16)';c.lineWidth=2;c.beginPath();c.arc(p.x,p.y,8,0,TAU);c.fill();c.stroke();c.beginPath();c.moveTo(p.x-5,p.y-5);c.lineTo(p.x+5,p.y+5);c.moveTo(p.x+5,p.y-5);c.lineTo(p.x-5,p.y+5);c.stroke();}
  }

  drawAxis3D(){
    const c=this.ctx,a=this.project3D({x:this.chuckFaceZ()-this.cfg.chuckLength-22,y:0,z:0}),b=this.project3D({x:30,y:0,z:0});c.strokeStyle='rgba(106,205,241,.75)';c.setLineDash([7,5]);c.lineWidth=1.2;c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();c.setLineDash([]);c.fillStyle='#76d3f5';c.font='700 11px system-ui';c.fillText('Z',b.x+5,b.y-4);
  }
}
