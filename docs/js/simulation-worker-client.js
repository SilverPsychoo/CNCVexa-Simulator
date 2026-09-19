import {STEP_FIELDS,STEP_STRIDE,TOOL_CODES} from './simulation-worker.js';

const number=value=>Number.isFinite(Number(value))?Number(value):0;

function encodedSteps(machine,steps){
  const data=new Float64Array(steps.length*STEP_STRIDE);
  let toolSize=machine==='lathe'?.8:10,toolType=machine==='lathe'?TOOL_CODES.od:TOOL_CODES.flat,toolAngle=90;
  for(let index=0;index<steps.length;index++){
    const step=steps[index]||{},base=index*STEP_STRIDE;
    if(machine==='lathe'){
      if(Number.isFinite(Number(step.noseRadius)))toolSize=Number(step.noseRadius);
    }else if(Number.isFinite(Number(step.diameter)))toolSize=Number(step.diameter);
    if(step.toolType&&TOOL_CODES[step.toolType]!==undefined)toolType=TOOL_CODES[step.toolType];
    if(Number.isFinite(Number(step.toolAngle)))toolAngle=Number(step.toolAngle);
    data[base+STEP_FIELDS.kind]=step.kind==='move'?1:step.kind==='toolchange'?2:0;
    data[base+STEP_FIELDS.cut]=step.cut?1:0;
    data[base+STEP_FIELDS.fromX]=number(step.from?.x);
    data[base+STEP_FIELDS.fromY]=number(step.from?.y);
    data[base+STEP_FIELDS.fromZ]=number(step.from?.z);
    data[base+STEP_FIELDS.toX]=number(step.to?.x);
    data[base+STEP_FIELDS.toY]=number(step.to?.y);
    data[base+STEP_FIELDS.toZ]=number(step.to?.z);
    data[base+STEP_FIELDS.toolSize]=Math.max(.001,toolSize);
    data[base+STEP_FIELDS.toolType]=toolType;
    data[base+STEP_FIELDS.toolAngle]=toolAngle;
  }
  return data;
}

export class SimulationWorkerClient{
  constructor({onMessage,onError}={}){
    this.onMessage=onMessage;
    this.onError=onError;
    this.available=typeof Worker!=='undefined';
    this.pending=false;
    this.simulationId=0;
    if(this.available)this.createWorker();
  }

  createWorker(){
    try{
      this.worker=new Worker(new URL('./simulation-worker.js',import.meta.url),{type:'module'});
      this.worker.addEventListener('message',event=>{
        const message=event.data||{};
        if(message.simulationId!==this.simulationId)return;
        if(message.type==='batch')this.pending=false;
        this.onMessage?.(message);
      });
      this.worker.addEventListener('error',error=>{this.available=false;this.pending=false;this.onError?.(error);});
    }catch(error){this.available=false;this.pending=false;this.onError?.(error);}
  }

  start({simulationId,machine,steps,cursor,config,depth,profile,innerProfile}){
    if(!this.available||!this.worker)return false;
    this.simulationId=simulationId;this.pending=false;
    const encoded=encodedSteps(machine,steps),message={type:'start',simulationId,machine,cursor,config,stepsBuffer:encoded.buffer},transfer=[encoded.buffer];
    if(depth){const copy=depth.slice();message.depthBuffer=copy.buffer;transfer.push(copy.buffer);}
    if(profile){const copy=profile.slice();message.profileBuffer=copy.buffer;transfer.push(copy.buffer);}
    if(innerProfile){const copy=innerProfile.slice();message.innerProfileBuffer=copy.buffer;transfer.push(copy.buffer);}
    this.worker.postMessage(message,transfer);
    return true;
  }

  run({simulationId,budgetMs,stepLimit,dirtyLimit=16000}){
    if(!this.available||!this.worker||this.pending||simulationId!==this.simulationId)return false;
    this.pending=true;this.worker.postMessage({type:'run',simulationId,budgetMs,stepLimit,dirtyLimit});return true;
  }

  pause(simulationId=this.simulationId){if(this.worker&&simulationId===this.simulationId)this.worker.postMessage({type:'pause',simulationId});}
  resume(simulationId=this.simulationId){if(this.worker&&simulationId===this.simulationId)this.worker.postMessage({type:'resume',simulationId});}
  cancel(simulationId=this.simulationId){if(this.worker&&simulationId===this.simulationId)this.worker.postMessage({type:'cancel',simulationId});this.pending=false;}
  destroy(){this.worker?.terminate();this.worker=null;this.available=false;this.pending=false;}
}
