const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export const STEP_STRIDE=12;
export const STEP_FIELDS=Object.freeze({
  kind:0,
  cut:1,
  fromX:2,
  fromY:3,
  fromZ:4,
  toX:5,
  toY:6,
  toZ:7,
  toolSize:8,
  toolType:9,
  toolAngle:10,
  reserved:11
});

export const TOOL_CODES=Object.freeze({flat:0,face:1,ball:2,drill:3,chamfer:4,od:5,finish:6,groove:7,thread:8,boring:9});

const now=()=>globalThis.performance?.now?.()??Date.now();

function millBounds(config){
  const top=config.tableTopZ+config.z;
  return config.zeroMode==='center'
    ?{minX:config.positionX-config.x/2,maxX:config.positionX+config.x/2,minY:config.positionY-config.y/2,maxY:config.positionY+config.y/2,maxZ:top}
    :{minX:config.positionX,maxX:config.positionX+config.x,minY:config.positionY,maxY:config.positionY+config.y,maxZ:top};
}

function createDirtyTracker(length){
  return{marks:new Uint32Array(length),indices:new Uint32Array(length),count:0,stamp:1};
}

function beginDirtyBatch(tracker){
  tracker.count=0;
  tracker.stamp++;
  if(tracker.stamp===0){tracker.marks.fill(0);tracker.stamp=1;}
}

function markDirty(tracker,index){
  if(tracker.marks[index]===tracker.stamp)return;
  tracker.marks[index]=tracker.stamp;
  tracker.indices[tracker.count++]=index;
}

export function createKernel({machine,config,stepsBuffer,cursor=-1,depthBuffer=null,profileBuffer=null,innerProfileBuffer=null}){
  const steps=new Float64Array(stepsBuffer);
  if(machine==='lathe'){
    const count=Math.ceil(config.length/config.resolution)+1;
    const profile=profileBuffer?new Float32Array(profileBuffer):new Float32Array(count).fill(config.diameter/2);
    const innerProfile=innerProfileBuffer?new Float32Array(innerProfileBuffer):new Float32Array(count);
    return{machine,config,steps,cursor,profile,innerProfile,outerDirty:createDirtyTracker(profile.length),innerDirty:createDirtyTracker(innerProfile.length)};
  }
  const nx=Math.ceil(config.x/config.resolution)+1,ny=Math.ceil(config.y/config.resolution)+1;
  const depth=depthBuffer?new Float32Array(depthBuffer):new Float32Array(nx*ny);
  return{machine:'mill',config,steps,cursor,nx,ny,depth,bounds:millBounds(config),dirty:createDirtyTracker(depth.length)};
}

function setMillDepth(kernel,index,value){
  if(value<=kernel.depth[index])return;
  kernel.depth[index]=value;
  markDirty(kernel.dirty,index);
}

function cutMillStep(kernel,base,deadline=Infinity){
  const f=STEP_FIELDS,data=kernel.steps,cfg=kernel.config,bounds=kernel.bounds;
  let job=kernel.activeCut;
  if(!job||job.base!==base){
    const ax=data[base+f.fromX],ay=data[base+f.fromY],az=data[base+f.fromZ],bx=data[base+f.toX],by=data[base+f.toY],bz=data[base+f.toZ],diameter=Math.max(.1,data[base+f.toolSize]||10),radius=diameter/2,type=data[base+f.toolType],angle=data[base+f.toolAngle]||90,length=Math.hypot(bx-ax,by-ay,bz-az),sampleStep=cfg.resolution*cfg.pathStep;
    job={base,sample:0,count:Math.max(1,Math.ceil(length/sampleStep)),ax,ay,az,bx,by,bz,radius,radius2:radius*radius,type,angle,flat:type===TOOL_CODES.flat||type===TOOL_CODES.face};kernel.activeCut=job;
  }
  while(job.sample<=job.count){
    if(!job.cells){
      const ratio=job.sample/job.count,x=job.ax+(job.bx-job.ax)*ratio,y=job.ay+(job.by-job.ay)*ratio,z=job.az+(job.bz-job.az)*ratio,radius=job.radius;
      if(z>bounds.maxZ+radius){job.sample++;if((job.sample&31)===0&&now()>=deadline)return false;continue;}
      const minI=Math.max(0,Math.floor((x-radius-bounds.minX)/cfg.resolution)),maxI=Math.min(kernel.nx-1,Math.ceil((x+radius-bounds.minX)/cfg.resolution)),minJ=Math.max(0,Math.floor((y-radius-bounds.minY)/cfg.resolution)),maxJ=Math.min(kernel.ny-1,Math.ceil((y+radius-bounds.minY)/cfg.resolution));
      job.cells={x,y,z,minI,maxI,minJ,maxJ,i:minI,j:minJ,flatDepth:job.flat?Math.min(cfg.z,Math.max(0,bounds.maxZ-z)):0,checks:0};
    }
    const cells=job.cells;
    while(cells.j<=cells.maxJ){
      while(cells.i<=cells.maxI){
        const i=cells.i++,j=cells.j,px=bounds.minX+i*cfg.resolution,py=bounds.minY+j*cfg.resolution,dx=px-cells.x,dy=py-cells.y,distance2=dx*dx+dy*dy;
        if(distance2<=job.radius2){
          let surfaceZ=cells.z;
          if(job.type===TOOL_CODES.ball)surfaceZ=cells.z+job.radius-Math.sqrt(Math.max(0,job.radius2-distance2));
          else if(job.type===TOOL_CODES.drill||job.type===TOOL_CODES.chamfer)surfaceZ=cells.z+Math.sqrt(distance2)/Math.tan(clamp(job.angle/2,5,89)*Math.PI/180);
          const value=job.flat?cells.flatDepth:Math.min(cfg.z,Math.max(0,bounds.maxZ-surfaceZ)),index=j*kernel.nx+i;
          if(value>kernel.depth[index])setMillDepth(kernel,index,value);
        }
        if((++cells.checks&511)===0&&now()>=deadline)return false;
      }
      cells.j++;cells.i=cells.minI;
    }
    job.cells=null;job.sample++;
    if((job.sample&3)===0&&now()>=deadline)return false;
  }
  kernel.activeCut=null;return true;
}

function setLatheRadius(kernel,index,value,inner){
  const target=inner?kernel.innerProfile:kernel.profile,tracker=inner?kernel.innerDirty:kernel.outerDirty;
  if(inner){
    if(value<=target[index])return;
  }else if(value===target[index])return;
  target[index]=value;
  markDirty(tracker,index);
}

function cutLatheStep(kernel,base,deadline=Infinity){
  const f=STEP_FIELDS,data=kernel.steps,cfg=kernel.config;
  let job=kernel.activeCut;
  if(!job||job.base!==base){const ax=data[base+f.fromX],az=data[base+f.fromZ],bx=data[base+f.toX],bz=data[base+f.toZ],nose=Math.max(.1,data[base+f.toolSize]||.8),type=data[base+f.toolType],length=Math.hypot(bx-ax,bz-az);job={base,sample:0,samples:Math.max(1,Math.ceil(length/Math.max(.25,cfg.resolution*.45))),ax,az,bx,bz,nose,inner:type===TOOL_CODES.boring||type===TOOL_CODES.drill};kernel.activeCut=job;}
  for(;job.sample<=job.samples;job.sample++){
    const ratio=job.sample/job.samples,x=job.ax+(job.bx-job.ax)*ratio,z=job.az+(job.bz-job.az)*ratio,radius=Math.abs(x)/2;
    if(z>job.nose||z<-cfg.length-job.nose){if((job.sample&31)===31&&now()>=deadline){job.sample++;return false;}continue;}
    const first=Math.max(0,Math.floor((-z-job.nose)/cfg.resolution)),last=Math.min(kernel.profile.length-1,Math.ceil((-z+job.nose)/cfg.resolution));
    for(let index=first;index<=last;index++){
      const dz=Math.abs(-index*cfg.resolution-z);
      if(dz>job.nose)continue;
      const effective=radius+Math.max(0,job.nose-Math.sqrt(Math.max(0,job.nose*job.nose-dz*dz)));
      if(job.inner)setLatheRadius(kernel,index,Math.max(kernel.innerProfile[index],effective),true);
      else setLatheRadius(kernel,index,Math.max(kernel.innerProfile[index]+.05,Math.min(kernel.profile[index],effective)),false);
    }
    if((job.sample&31)===31&&now()>=deadline){job.sample++;return false;}
  }
  kernel.activeCut=null;return true;
}

function compactDirty(tracker,values){
  const indices=tracker.indices.slice(0,tracker.count),result=new Float32Array(tracker.count);
  for(let i=0;i<tracker.count;i++)result[i]=values[indices[i]];
  return{indices,values:result};
}

export function processKernelBatch(kernel,{budgetMs=8,stepLimit=512,dirtyLimit=16000}={}){
  const started=now(),deadline=started+budgetMs,stepCount=kernel.steps.length/STEP_STRIDE,startIndex=kernel.cursor;
  if(kernel.machine==='lathe'){beginDirtyBatch(kernel.outerDirty);beginDirtyBatch(kernel.innerDirty);}else beginDirtyBatch(kernel.dirty);
  let processed=0,partial=false;
  while(kernel.cursor+1<stepCount&&processed<stepLimit){
    const index=kernel.cursor+1,base=index*STEP_STRIDE,kind=kernel.steps[base+STEP_FIELDS.kind],cut=kernel.steps[base+STEP_FIELDS.cut]===1;
    if(kind===1&&cut){const complete=kernel.machine==='lathe'?cutLatheStep(kernel,base,deadline):cutMillStep(kernel,base,deadline);if(!complete){partial=true;break;}}
    kernel.cursor=index;processed++;
    const dirtyCount=kernel.machine==='lathe'?kernel.outerDirty.count+kernel.innerDirty.count:kernel.dirty.count;
    if(dirtyCount>=dirtyLimit)break;
    if((processed&7)===0&&now()>=deadline)break;
  }
  const elapsed=now()-started,done=!kernel.activeCut&&kernel.cursor>=stepCount-1;
  if(kernel.machine==='lathe'){
    const outer=compactDirty(kernel.outerDirty,kernel.profile),inner=compactDirty(kernel.innerDirty,kernel.innerProfile);
    return{machine:kernel.machine,startIndex,endIndex:kernel.cursor,processed,elapsed,done,partial,indices:outer.indices,values:outer.values,innerIndices:inner.indices,innerValues:inner.values};
  }
  const changes=compactDirty(kernel.dirty,kernel.depth);
  return{machine:kernel.machine,startIndex,endIndex:kernel.cursor,processed,elapsed,done,partial,indices:changes.indices,values:changes.values};
}

const workerScope=typeof WorkerGlobalScope!=='undefined'&&globalThis instanceof WorkerGlobalScope;
if(workerScope){
  let activeId=0,kernel=null,paused=false;
  globalThis.addEventListener('message',event=>{
    const message=event.data||{};
    if(message.type==='start'){
      activeId=message.simulationId;paused=false;kernel=createKernel(message);
      globalThis.postMessage({type:'ready',simulationId:activeId,cursor:kernel.cursor});
      return;
    }
    if(message.simulationId!==activeId)return;
    if(message.type==='cancel'){kernel=null;paused=false;return;}
    if(message.type==='pause'){paused=true;return;}
    if(message.type==='resume'){paused=false;return;}
    if(message.type!=='run'||!kernel||paused)return;
    const result=processKernelBatch(kernel,message);
    const transfer=[result.indices.buffer,result.values.buffer];
    if(result.innerIndices)transfer.push(result.innerIndices.buffer,result.innerValues.buffer);
    globalThis.postMessage({type:'batch',simulationId:activeId,...result},transfer);
  });
}
