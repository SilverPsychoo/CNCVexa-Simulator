import {evaluateExpression,evaluateCondition} from './expression.js?v=5.4.0';

const stripComments=line=>line.replace(/\([^)]*\)/g,'').replace(/;.*/,'').trim().toUpperCase();
const unitFactor=state=>state.units==='G20'?25.4:1;
const canonicalG=raw=>{const [whole,decimal]=String(raw).split('.');return `G${whole.padStart(2,'0')}${decimal!==undefined?`.${decimal}`:''}`;};
const canonicalM=raw=>`M${String(raw).padStart(2,'0')}`;
const cloneState=s=>({...s,machine:{...s.machine},programmed:{...s.programmed},work:{...s.work},g71:s.g71?{...s.g71}:null,g72:s.g72?{...s.g72}:null,g73:s.g73?{...s.g73}:null,g74:s.g74?{...s.g74}:null,g75:s.g75?{...s.g75}:null,g76:s.g76?{...s.g76}:null,g83:s.g83?{...s.g83}:null});
const EPS=1e-7;

export class LatheInterpreter{
  constructor(config={}){this.config=config;this.reset();}
  reset(){
    this.programs=new Map();this.programOrder=[];this.variables=new Map();this.diagnostics=[];this.trace=[];this.steps=[];this.callStack=[];this.execCount=0;this.ended=false;this.lastTool=0;
    this.state={machine:{x:80,z:5},programmed:{x:80,z:5},work:{x:80,z:5},motion:'G00',distance:'G90',units:'G21',plane:'G18',feedMode:'G95',speedMode:'G97',wcs:'G54',feed:0,rpm:0,commandedSpeed:0,spindleLimit:4000,spindle:'OFF',coolant:'OFF',tool:0,offset:0,radiusComp:'G40',line:0,block:'—',g71:null,g72:null,g73:null,g74:null,g75:null,g76:null,g83:null};
  }
  warn(type,line,message,code=''){this.diagnostics.push({type,line,message,code});}
  getOffset(wcs=this.state.wcs){return this.config.offsets?.[wcs]||{x:0,z:0};}
  syncWork(){const o=this.getOffset(),p=this.state.programmed;this.state.work={x:p.x-o.x,z:p.z-o.z};}
  wordValue(raw){return evaluateExpression(raw,this.variables);}
  parseWords(clean){
    const words={},re=/([A-Z])((?:#\[.*?\]|#\d+|\[[^\]]+\]|[+\-]?(?:\d+\.?\d*|\.\d+)))/g;let m;
    while((m=re.exec(clean))){try{words[m[1]]=this.wordValue(m[2].replace(/^\[|\]$/g,''));}catch(error){throw new Error(`${m[1]}: ${error.message}`);}}
    return words;
  }
  rawWord(clean,letter){const m=clean.match(new RegExp(`(?:^|\\s)${letter}([+\\-]?\\d+(?:\\.\\d+)?)`));return m?.[1]??null;}
  parse(source){
    this.reset();const raw=source.replace(/\r/g,'').split('\n');let current={id:'MAIN',lines:[]};this.programs.set('MAIN',current);
    raw.forEach((text,index)=>{const clean=stripComments(text),om=clean.match(/^O(\d+)/);if(om){current={id:String(Number(om[1])),lines:[]};this.programs.set(current.id,current);this.programOrder.push(current.id);}current.lines.push({text,clean,index:index+1});});
    for(const p of this.programs.values()){
      p.labels=new Map();p.whilePairs=new Map();const stack=[];
      p.lines.forEach((line,i)=>{const label=line.clean.match(/^N(\d+)/);if(label)p.labels.set(String(Number(label[1])),i);const wm=line.clean.match(/\bWHILE\s*\[.*?\]\s*DO(\d+)/);if(wm)stack.push({id:wm[1],i});const em=line.clean.match(/^END(\d+)/);if(em){let k=stack.length-1;while(k>=0&&stack[k].id!==em[1])k--;if(k>=0){const w=stack.splice(k,1)[0];p.whilePairs.set(w.i,i);p.whilePairs.set(i,w.i);}else this.warn('error',line.index,`END${em[1]} sin WHILE`);}});
    }
    const main=this.programs.get('MAIN');const hasMain=main?.lines.some(line=>line.clean&&!/^O\d+/.test(line.clean));this.pc={program:hasMain?'MAIN':(this.programOrder[0]||'MAIN'),index:0};this.syncWork();return this;
  }
  resolveTarget(words,machineBlock=false){
    const unit=unitFactor(this.state),o=this.getOffset(),target={...this.state.programmed};
    if(words.X!==undefined)target.x=machineBlock?words.X*unit:(this.state.distance==='G91'?target.x+words.X*unit:words.X*unit+o.x);
    if(words.Z!==undefined)target.z=machineBlock?words.Z*unit:(this.state.distance==='G91'?target.z+words.Z*unit:words.Z*unit+o.z);
    if(words.U!==undefined)target.x+=words.U*unit;
    if(words.W!==undefined)target.z+=words.W*unit;
    return target;
  }
  currentRpm(diameter=this.state.programmed.x){
    if(this.state.speedMode==='G97')return Math.max(0,this.state.commandedSpeed||this.state.rpm||0);
    const dia=Math.max(.1,Math.abs(diameter)),s=this.state.commandedSpeed||0,metric=this.state.units==='G21';
    const rpm=metric?(1000*s)/(Math.PI*dia):(s*3.82)/(dia/25.4);
    return Math.min(this.state.spindleLimit||99999,Math.max(0,rpm));
  }
  compensatedSegment(from,to,tool){
    if(this.state.radiusComp==='G40'||this.state.motion==='G00'||['drill','groove','thread'].includes(tool.type))return{from:{...from},to:{...to},offset:{x:0,z:0}};
    const dr=(to.x-from.x)/2,dz=to.z-from.z,len=Math.hypot(dr,dz);if(len<EPS)return{from:{...from},to:{...to},offset:{x:0,z:0}};
    let sign=this.state.radiusComp==='G41'?1:-1;
    const orientation=Number(tool.orientation||3);if([1,2,5,6].includes(orientation))sign*=-1;
    const nr=-dz/len,nz=dr/len,r=Math.max(0,tool.noseRadius||0),ox=2*nr*r*sign,oz=nz*r*sign;
    return{from:{x:from.x+ox,z:from.z+oz},to:{x:to.x+ox,z:to.z+oz},offset:{x:ox,z:oz}};
  }
  pointInsideInitialStock(point){const stock=this.config.stock||{},dia=Math.max(0,stock.diameter||0),length=Math.max(0,stock.length||0);return !!dia&&!!length&&point.z<=0+EPS&&point.z>=-length-EPS&&Math.abs(point.x)<dia-EPS;}
  segmentHitsInitialStock(from,to){
    const stock=this.config.stock||{},dia=Math.max(0,stock.diameter||0),length=Math.max(0,stock.length||0);if(!dia||!length)return false;
    const samples=18;for(let i=0;i<=samples;i++){const t=i/samples,x=from.x+(to.x-from.x)*t,z=from.z+(to.z-from.z)*t;if(z<=0+EPS&&z>=-length-EPS&&Math.abs(x)<dia-EPS)return true;}return false;
  }
  safetyForMove(from,to,type,tool,line,extra={}){
    const stock=this.config.stock||{},safety=stock.safety||{},issues=[];if(safety.enabled===false)return issues;
    const chuckClearance=Math.max(0,Number(safety.chuckClearance??2)),holderClearance=Math.max(0,Number(safety.holderClearance??4)),length=Math.max(0,stock.length||0),stickout=Math.max(0,Math.min(Number(stock.stickout??length),length)),chuckRadius=Math.max((stock.diameter||0)*.72,34);
    if(Math.min(from.x,to.x)<-EPS)issues.push({severity:'error',code:'X_NEGATIVE',message:'La trayectoria cruza por debajo de la línea central X0'});
    if(Math.min(from.z,to.z)<-stickout-chuckClearance&&Math.min(Math.abs(from.x),Math.abs(to.x))/2<chuckRadius+holderClearance)issues.push({severity:'error',code:'CHUCK',message:`Posible colisión de ${tool.name||'la herramienta'} con el plato o las mordazas`});
    if(type==='G00'&&!extra.cycle&&this.pointInsideInitialStock(to)&&this.segmentHitsInitialStock(from,to))issues.push({severity:'warning',code:'RAPID_STOCK',message:'Movimiento rápido atraviesa el volumen inicial de la barra'});
    const xLimit=Number(safety.xLimit||400),zMin=Number(safety.zMin??-(length+250)),zMax=Number(safety.zMax??250);
    if(Math.max(Math.abs(from.x),Math.abs(to.x))>xLimit)issues.push({severity:'error',code:'X_TRAVEL',message:`Sobrecarrera aproximada del eje X (límite ±${xLimit} mm)`});
    if(Math.min(from.z,to.z)<zMin||Math.max(from.z,to.z)>zMax)issues.push({severity:'error',code:'Z_TRAVEL',message:`Sobrecarrera aproximada del eje Z (${zMin} a ${zMax} mm)`});
    for(const issue of issues)this.warn(issue.severity==='error'?'warning':issue.severity,line,issue.message,issue.code);return issues;
  }
  addMove(programmedFrom,programmedTo,type,line,source,extra={}){
    const tool={name:'Buril exterior',type:'od',noseRadius:.8,orientation:3,insertWidth:6,...(this.config.tools?.[this.state.tool]||{})};
    const comp=this.compensatedSegment(programmedFrom,programmedTo,tool),from=comp.from,to=comp.to,cut=type!=='G00'&&this.state.spindle!=='OFF';
    const rpm=this.currentRpm((Math.abs(programmedFrom.x)+Math.abs(programmedTo.x))/2);this.state.rpm=rpm;const collisions=this.safetyForMove(from,to,type,tool,line,extra);
    this.steps.push({kind:'move',machineType:'lathe',from:{...from},to:{...to},programmedFrom:{...programmedFrom},programmedTo:{...programmedTo},type,line,source,feed:this.state.feed,rpm,tool:this.state.tool,offset:this.state.offset,toolType:tool.type,toolName:tool.name,noseRadius:tool.noseRadius||.8,insertWidth:tool.insertWidth||6,orientation:tool.orientation||3,radiusComp:this.state.radiusComp,compOffset:comp.offset,cut,collisions,...extra,state:cloneState(this.state)});
    this.state.programmed={...programmedTo};this.state.machine={...to};this.syncWork();
  }
  addToolChange(line,source,fromTool,toTool,offset){
    const tool={name:'Herramienta de torno',type:'od',noseRadius:.8,orientation:3,insertWidth:6,...(this.config.tools?.[toTool]||{})};
    this.steps.push({kind:'toolchange',machineType:'lathe',line,source,fromTool,toTool,tool:toTool,offset,toolType:tool.type,toolName:tool.name,noseRadius:tool.noseRadius,insertWidth:tool.insertWidth,orientation:tool.orientation,state:cloneState(this.state)});
  }
  arcPoints(from,to,cw,words){
    const unit=unitFactor(this.state),sx=from.x,sz=from.z,tx=to.x,tz=to.z;let cx,cz,r;
    if(words.I!==undefined||words.K!==undefined){cx=sx+(words.I||0)*unit;cz=sz+(words.K||0)*unit;r=Math.hypot(sx-cx,sz-cz);}
    else if(words.R!==undefined){r=Math.abs(words.R)*unit;const dx=tx-sx,dz=tz-sz,q=Math.hypot(dx,dz);if(q<1e-9)throw new Error('Arco completo requiere I/K');if(q>2*r+1e-6)throw new Error('Radio R demasiado pequeño');const mx=(sx+tx)/2,mz=(sz+tz)/2,h=Math.sqrt(Math.max(0,r*r-q*q/4)),sign=(cw?-1:1)*(words.R<0?-1:1);cx=mx-sign*dz/q*h;cz=mz+sign*dx/q*h;}
    else throw new Error('Arco G18 sin I/K o R');
    let a0=Math.atan2(sz-cz,sx-cx),a1=Math.atan2(tz-cz,tx-cx),sweep=a1-a0;if(cw&&sweep>=0)sweep-=Math.PI*2;if(!cw&&sweep<=0)sweep+=Math.PI*2;
    const count=Math.max(8,Math.ceil(Math.abs(sweep)*r/1.5)),points=[];for(let i=1;i<=count;i++){const t=i/count,a=a0+sweep*t;points.push({x:cx+r*Math.cos(a),z:cz+r*Math.sin(a)});}return points;
  }
  setVar(line,pc){const m=line.clean.match(/^#(\d+|\[[^\]]+\])\s*=\s*(.+)$/);if(!m)return false;const id=m[1].startsWith('[')?Math.trunc(this.wordValue(m[1].slice(1,-1))):Number(m[1]),value=this.wordValue(m[2]);this.variables.set(id,value);this.trace.push(`L${line.index}: #${id} = ${value}`);pc.index++;return true;}
  executeFlow(line,pc,program){
    const ifGoto=line.clean.match(/^IF\s*\[(.+)\]\s*GOTO\s*(\d+)/);if(ifGoto){if(evaluateCondition(ifGoto[1],this.variables)){const dest=program.labels.get(String(Number(ifGoto[2])));if(dest===undefined)this.warn('error',line.index,`N${ifGoto[2]} no existe`);else pc.index=dest;}else pc.index++;return true;}
    const ifThen=line.clean.match(/^IF\s*\[(.+)\]\s*THEN\s*(#.+)$/);if(ifThen){if(evaluateCondition(ifThen[1],this.variables)){const fake={...line,clean:ifThen[2]};this.setVar(fake,pc);}else pc.index++;return true;}
    const go=line.clean.match(/^GOTO\s*(\d+)/);if(go){const dest=program.labels.get(String(Number(go[1])));if(dest===undefined){this.warn('error',line.index,`N${go[1]} no existe`);pc.index++;}else pc.index=dest;return true;}
    const wh=line.clean.match(/^WHILE\s*\[(.+)\]\s*DO(\d+)/);if(wh){if(evaluateCondition(wh[1],this.variables))pc.index++;else pc.index=(program.whilePairs.get(pc.index)??pc.index)+1;return true;}
    const end=line.clean.match(/^END(\d+)/);if(end){pc.index=program.whilePairs.get(pc.index)??pc.index+1;return true;}return false;
  }
  profileBetween(program,p,q){const start=program.labels.get(String(Number(p))),end=program.labels.get(String(Number(q)));if(start===undefined||end===undefined||end<=start)return null;const saved=cloneState(this.state),points=[];let pos={...saved.programmed};for(let i=start;i<=end;i++){const clean=program.lines[i].clean;if(!clean)continue;let words;try{words=this.parseWords(clean);}catch{continue;}const target={...pos};const unit=unitFactor(saved),o=this.getOffset();if(words.X!==undefined)target.x=words.X*unit+o.x;if(words.Z!==undefined)target.z=words.Z*unit+o.z;if(words.U!==undefined)target.x+=words.U*unit;if(words.W!==undefined)target.z+=words.W*unit;if(target.x!==pos.x||target.z!==pos.z){points.push({from:{...pos},to:{...target},line:program.lines[i].index});pos=target;}}return points.length?points:null;}
  executeG71(words,line,program){
    if(words.P===undefined||words.Q===undefined){this.state.g71={depth:this.cycleIncrement(words.U??words.D,2),retract:this.cycleIncrement(words.R,1)};return;}
    const profile=this.profileBetween(program,words.P,words.Q);if(!profile){this.warn('error',line.index,'G71 no encontró el perfil P/Q');return;}
    const depth=this.state.g71?.depth||this.cycleIncrement(words.D,2),finishX=this.cycleIncrement(words.U,0),finishZ=this.cycleIncrement(words.W,0),stockDia=this.config.stock?.diameter||Math.max(...profile.map(s=>s.from.x),this.state.programmed.x);
    const minDia=Math.max(0,Math.min(...profile.map(s=>Math.min(s.from.x,s.to.x)))+finishX);let passDia=stockDia-depth;
    while(passDia>minDia+1e-6){let cursor={...this.state.programmed,x:passDia};this.addMove(this.state.programmed,cursor,'G00',line.index,line.text,{cycle:'G71'});for(const seg of profile){const target={x:Math.max(passDia,Math.min(stockDia,seg.to.x+finishX)),z:seg.to.z+(seg.to.z<0?finishZ:-finishZ)};this.addMove(cursor,target,'G01',line.index,line.text,{cycle:'G71'});cursor=target;}passDia-=depth;}
    this.trace.push(`L${line.index}: G71 desbaste ${profile.length} segmentos`);
  }
  executeG72(words,line,program){
    if(words.P===undefined||words.Q===undefined){this.state.g72={depth:this.cycleIncrement(words.W??words.D,2),retract:this.cycleIncrement(words.R,1)};return;}
    const profile=this.profileBetween(program,words.P,words.Q);if(!profile){this.warn('error',line.index,'G72 no encontró el perfil P/Q');return;}
    const depth=this.state.g72?.depth||this.cycleIncrement(words.D,2),finishX=this.cycleIncrement(words.U,0),finishZ=this.cycleIncrement(words.W,0),front=Math.max(0,this.state.programmed.z),minZ=Math.min(...profile.map(s=>Math.min(s.from.z,s.to.z)))+finishZ;let passZ=front-depth;
    while(passZ>minZ+EPS){let cursor={...this.state.programmed,z:passZ};this.addMove(this.state.programmed,cursor,'G00',line.index,line.text,{cycle:'G72'});for(const seg of profile){const target={x:Math.max(0,seg.to.x+finishX),z:Math.max(passZ,seg.to.z+finishZ)};this.addMove(cursor,target,'G01',line.index,line.text,{cycle:'G72'});cursor=target;}passZ-=depth;}
    this.trace.push(`L${line.index}: G72 desbaste frontal ${profile.length} segmentos`);
  }

  executeG73(words,line,program){
    if(words.P===undefined||words.Q===undefined){this.state.g73={shiftX:this.cycleIncrement(words.U,0),shiftZ:this.cycleIncrement(words.W,0),repeats:Math.max(1,Math.trunc(words.R||1))};return;}
    const profile=this.profileBetween(program,words.P,words.Q);if(!profile){this.warn('error',line.index,'G73 no encontró el perfil P/Q');return;}
    const base=this.state.g73||{shiftX:this.cycleIncrement(words.U,0),shiftZ:this.cycleIncrement(words.W,0),repeats:Math.max(1,Math.trunc(words.R||1))},finishX=this.cycleIncrement(words.U,0),finishZ=this.cycleIncrement(words.W,0);
    for(let pass=base.repeats;pass>=1;pass--){const ratio=pass/base.repeats,ox=base.shiftX*ratio+finishX,oz=base.shiftZ*ratio+finishZ;let cursor={...this.state.programmed};for(const seg of profile){const target={x:Math.max(0,seg.to.x+ox),z:seg.to.z+(seg.to.z<0?oz:-oz)};this.addMove(cursor,target,'G01',line.index,line.text,{cycle:'G73',patternPass:base.repeats-pass+1,patternPasses:base.repeats});cursor=target;}}
    this.trace.push(`L${line.index}: G73 patrón irregular ${base.repeats} repeticiones`);
  }
  executeG70(words,line,program){const profile=this.profileBetween(program,words.P,words.Q);if(!profile){this.warn('error',line.index,'G70 no encontró el perfil P/Q');return;}let cursor={...this.state.programmed};for(const seg of profile){const target={...seg.to};this.addMove(cursor,target,'G01',line.index,line.text,{cycle:'G70'});cursor=target;}this.trace.push(`L${line.index}: G70 acabado ${profile.length} segmentos`);}
  cycleIncrement(value,fallback=1){if(value===undefined)return fallback;const unit=unitFactor(this.state),raw=Math.abs(value);return raw>50?raw/1000*unit:raw*unit;}
  executeG74(words,line){
    if(words.X===undefined&&words.Z===undefined){this.state.g74={retract:Math.abs(words.R||1)*unitFactor(this.state)};return;}
    const retract=this.state.g74?.retract||Math.abs(words.R||1)*unitFactor(this.state),target=this.resolveTarget(words),zStep=this.cycleIncrement(words.Q,2),xStep=this.cycleIncrement(words.P,2),start={...this.state.programmed};
    const tool=this.config.tools?.[this.state.tool]||{};if(tool.type==='drill'||words.X===undefined||Math.abs(target.x)<=Math.max(1,Math.abs(start.x)*.15)){
      let z=start.z-zStep;while(z>target.z+EPS){this.addMove(this.state.programmed,{x:start.x,z},'G01',line.index,line.text,{cycle:'G74',peck:true});this.addMove(this.state.programmed,{x:start.x,z:z+retract},'G00',line.index,line.text,{cycle:'G74',retract:true});z-=zStep;}this.addMove(this.state.programmed,target,'G01',line.index,line.text,{cycle:'G74',peck:true});
    }else{
      const dir=target.x<start.x?-1:1;let x=start.x+dir*xStep;while((dir<0&&x>target.x+EPS)||(dir>0&&x<target.x-EPS)){this.addMove(this.state.programmed,{x,z:target.z},'G01',line.index,line.text,{cycle:'G74',groove:true});this.addMove(this.state.programmed,{x,z:start.z+retract},'G00',line.index,line.text,{cycle:'G74',retract:true});x+=dir*xStep;}this.addMove(this.state.programmed,target,'G01',line.index,line.text,{cycle:'G74',groove:true});
    }
    this.trace.push(`L${line.index}: G74 ciclo frontal/intermitente`);
  }
  executeG75(words,line){
    if(words.X===undefined&&words.Z===undefined){this.state.g75={retract:Math.abs(words.R||1)*unitFactor(this.state)};return;}
    const retract=this.state.g75?.retract||Math.abs(words.R||1)*unitFactor(this.state),target=this.resolveTarget(words),xStep=this.cycleIncrement(words.P,2),zStep=this.cycleIncrement(words.Q,2),start={...this.state.programmed},zDir=target.z<start.z?-1:1;
    let z=start.z;while((zDir<0&&z>target.z+EPS)||(zDir>0&&z<target.z-EPS)){const nextZ=zDir<0?Math.max(target.z,z-zStep):Math.min(target.z,z+zStep);this.addMove(this.state.programmed,{x:start.x,z:nextZ},'G00',line.index,line.text,{cycle:'G75'});const xDir=target.x<start.x?-1:1;let x=start.x+xDir*xStep;while((xDir<0&&x>target.x+EPS)||(xDir>0&&x<target.x-EPS)){this.addMove(this.state.programmed,{x,z:nextZ},'G01',line.index,line.text,{cycle:'G75',groove:true});this.addMove(this.state.programmed,{x:x-xDir*retract,z:nextZ},'G00',line.index,line.text,{cycle:'G75',retract:true});x+=xDir*xStep;}this.addMove(this.state.programmed,{x:target.x,z:nextZ},'G01',line.index,line.text,{cycle:'G75',groove:true});this.addMove(this.state.programmed,{x:start.x,z:nextZ},'G00',line.index,line.text,{cycle:'G75',retract:true});z=nextZ;}
    this.trace.push(`L${line.index}: G75 ranurado radial repetitivo`);
  }
  threadPasses({start,target,height,firstDepth,finish=0,finishPasses=2,pitch=1,taper=0,angle=60,line,source,format='2 bloques'}){
    const safeHeight=Math.max(.001,height),safeFirst=Math.max(.02,firstDepth),passes=Math.max(2,Math.ceil(safeHeight/safeFirst)+Math.max(0,finishPasses));
    for(let i=1;i<=passes;i++){
      const cutting=i<=passes-finishPasses,ratio=cutting?Math.min(1,i/Math.max(1,passes-finishPasses)):1,depth=safeHeight*Math.sqrt(ratio),passX=Math.max(target.x+2*finish,start.x-2*depth),endX=passX+2*taper;
      this.addMove(this.state.programmed,{x:passX,z:start.z},'G00',line.index,source,{cycle:'G76',threadPass:i,threadPasses:passes,threadPitch:pitch,threadAngle:angle,threadFormat:format});
      this.addMove(this.state.programmed,{x:endX,z:target.z},'G01',line.index,source,{cycle:'G76',threadPass:i,threadPasses:passes,threadPitch:pitch,threadAngle:angle,threadTaper:taper,threadFormat:format,thread:true});
      this.addMove(this.state.programmed,{x:start.x,z:target.z+Math.min(2,Math.max(.5,pitch*2))},'G00',line.index,source,{cycle:'G76',retract:true});
    }
    this.trace.push(`L${line.index}: G76 ${format} · ${passes} pasadas · paso ${pitch} · ángulo ${angle}°`);
  }
  executeG76(words,line,clean){
    const singleLine=words.X!==undefined&&words.Z!==undefined&&(words.K!==undefined||words.D!==undefined||words.A!==undefined||words.I!==undefined);
    if(singleLine){
      const target=this.resolveTarget(words),start={...this.state.programmed},height=this.cycleIncrement(words.K,Math.max(.1,Math.abs(start.x-target.x)/2)),firstDepth=this.cycleIncrement(words.D,Math.max(.05,height/4)),pitch=Math.abs(words.F||1)*unitFactor(this.state),taper=(words.I||0)*unitFactor(this.state),angle=Math.abs(words.A||60);
      const expected=Math.abs(start.x-target.x)/2;if(Math.abs(expected-height)>.25)this.warn('warning',line.index,`G76: K (${height} mm radial) no coincide con X final (${expected.toFixed(3)} mm radial)`,'G76_DEPTH');
      this.threadPasses({start,target,height,firstDepth,finish:0,finishPasses:1,pitch,taper,angle,line,source:line.text,format:'1 bloque X Z I K D A F'});return;
    }
    if(words.X===undefined&&words.Z===undefined){
      const rawP=(this.rawWord(clean,'P')||'020060').replace(/\D/g,'').padStart(6,'0').slice(-6);
      this.state.g76={finishPasses:Number(rawP.slice(0,2))||2,chamfer:Number(rawP.slice(2,4))||0,angle:Number(rawP.slice(4,6))||60,minDepth:this.cycleIncrement(words.Q,.1),finishAllowance:this.cycleIncrement(words.R,0)};return;
    }
    const target=this.resolveTarget(words),start={...this.state.programmed},rawP=this.rawWord(clean,'P'),height=this.cycleIncrement(rawP!==null?Number(rawP):words.P,Math.max(.1,Math.abs(start.x-target.x)/2)),firstDepth=this.cycleIncrement(words.Q,this.state.g76?.minDepth||Math.max(.05,height/4)),finish=this.state.g76?.finishAllowance||0,finishPasses=this.state.g76?.finishPasses||2,pitch=Math.abs(words.F||1)*unitFactor(this.state),taper=(words.R||0)*unitFactor(this.state),angle=this.state.g76?.angle||60;
    this.threadPasses({start,target,height,firstDepth,finish,finishPasses,pitch,taper,angle,line,source:line.text,format:'2 bloques P/Q/R'});
  }
  executeG83(words,line){
    if(words.Z===undefined){this.warn('error',line.index,'G83 requiere profundidad Z','G83_Z');return;}
    const unit=unitFactor(this.state),start={...this.state.programmed},target=this.resolveTarget(words),peck=this.cycleIncrement(words.Q,2),dwell=Math.max(0,words.P||0),dir=target.z<start.z?-1:1,o=this.getOffset(),retractZ=words.R===undefined?start.z:(this.state.distance==='G91'?start.z+words.R*unit:words.R*unit+o.z);
    if(peck<=EPS){this.warn('error',line.index,'G83 requiere un peck Q mayor que cero','G83_Q');return;}
    let depth=start.z;
    while((dir<0&&depth>target.z+EPS)||(dir>0&&depth<target.z-EPS)){
      const next=dir<0?Math.max(target.z,depth-peck):Math.min(target.z,depth+peck);
      this.addMove(this.state.programmed,{x:start.x,z:next},'G01',line.index,line.text,{cycle:'G83',drill:true,peck:true,dwell,toolType:'drill',toolName:'Broca axial'});
      if(Math.abs(next-target.z)>EPS)this.addMove(this.state.programmed,{x:start.x,z:retractZ},'G00',line.index,line.text,{cycle:'G83',drill:true,retract:true,toolType:'drill',toolName:'Broca axial'});
      depth=next;
    }
    this.trace.push(`L${line.index}: G83 barrenado axial · Z${target.z} · Q${peck} · P${dwell} ms`);
  }
  executeBlock(line,pc,program){
    if(!line.clean||/^O\d+/.test(line.clean)){pc.index++;return;}
    if(this.setVar(line,pc)||this.executeFlow(line,pc,program))return;
    let words;try{words=this.parseWords(line.clean);}catch(error){this.warn('error',line.index,error.message);pc.index++;return;}
    const gCodes=[...line.clean.matchAll(/G(\d+(?:\.\d+)?)/g)].map(m=>canonicalG(m[1])),mCodes=[...line.clean.matchAll(/M(\d+)/g)].map(m=>canonicalM(m[1]));
    this.state.line=line.index;this.state.block=line.clean;
    const tMatch=line.clean.match(/\bT(\d{1,4})\b/);if(tMatch){const original=tMatch[1],previous=this.state.tool;if(original.length<=2){this.state.tool=Number(original);this.state.offset=Number(original);}else{const raw=original.padStart(4,'0');this.state.tool=Number(raw.slice(0,2));this.state.offset=Number(raw.slice(2));}if(this.state.tool!==previous)this.addToolChange(line.index,line.text,previous,this.state.tool,this.state.offset);this.lastTool=this.state.tool;this.trace.push(`L${line.index}: T${String(this.state.tool).padStart(2,'0')}${String(this.state.offset).padStart(2,'0')}`);}
    for(const g of gCodes){
      if(['G00','G01','G02','G03'].includes(g))this.state.motion=g;
      else if(g==='G18')this.state.plane='G18';else if(g==='G20'||g==='G21')this.state.units=g;else if(g==='G90'||g==='G91')this.state.distance=g;
      else if(g==='G94'||g==='G98')this.state.feedMode='G94';else if(g==='G95'||g==='G99')this.state.feedMode='G95';else if(g==='G96'||g==='G97')this.state.speedMode=g;
      else if(/^G5[4-9]$/.test(g))this.state.wcs=g;else if(['G40','G41','G42'].includes(g))this.state.radiusComp=g;
    }
    if(words.F!==undefined)this.state.feed=words.F*unitFactor(this.state);
    if(words.S!==undefined){if(gCodes.includes('G50'))this.state.spindleLimit=words.S;else this.state.commandedSpeed=words.S;}
    for(const m of mCodes){if(m==='M03')this.state.spindle='CW';else if(m==='M04')this.state.spindle='CCW';else if(m==='M05')this.state.spindle='OFF';else if(m==='M08')this.state.coolant='ON';else if(m==='M09')this.state.coolant='OFF';else if(m==='M30'||m==='M02')this.ended=true;}
    if(gCodes.includes('G71')){this.executeG71(words,line,program);pc.index++;return;}if(gCodes.includes('G72')){this.executeG72(words,line,program);pc.index++;return;}if(gCodes.includes('G73')){this.executeG73(words,line,program);pc.index++;return;}if(gCodes.includes('G70')){this.executeG70(words,line,program);pc.index++;return;}if(gCodes.includes('G74')){this.executeG74(words,line);pc.index++;return;}if(gCodes.includes('G75')){this.executeG75(words,line);pc.index++;return;}if(gCodes.includes('G76')){this.executeG76(words,line,line.clean);pc.index++;return;}if(gCodes.includes('G83')){this.executeG83(words,line);pc.index++;return;}
    const m98=mCodes.includes('M98'),m99=mCodes.includes('M99');if(m98&&words.P!==undefined){const id=String(Math.trunc(words.P));if(!this.programs.has(id))this.warn('error',line.index,`Subprograma O${id} no existe`);else{this.callStack.push({program:pc.program,index:pc.index+1,remaining:Math.max(1,Math.trunc(words.L||1)),target:id});pc.program=id;pc.index=0;return;}}
    if(m99){const call=this.callStack.at(-1);if(call){if(call.remaining>1){call.remaining--;pc.program=call.target;pc.index=0;}else{this.callStack.pop();pc.program=call.program;pc.index=call.index;}}else this.ended=true;return;}
    const hasMotion=['X','Z','U','W'].some(k=>words[k]!==undefined);if(hasMotion){const from={...this.state.programmed},to=this.resolveTarget(words,gCodes.includes('G53'));if(this.state.motion==='G02'||this.state.motion==='G03'){try{let cursor=from;for(const point of this.arcPoints(from,to,this.state.motion==='G02',words)){this.addMove(cursor,point,this.state.motion,line.index,line.text,{plane:'G18'});cursor=point;}}catch(error){this.warn('error',line.index,error.message);}}else this.addMove(from,to,this.state.motion,line.index,line.text,{plane:'G18'});}
    pc.index++;
  }
  compile(){
    while(!this.ended&&this.execCount++<100000){const program=this.programs.get(this.pc.program);if(!program){this.warn('error',0,`Programa ${this.pc.program} no existe`);break;}if(this.pc.index>=program.lines.length){if(this.callStack.length){const call=this.callStack.pop();this.pc={program:call.program,index:call.index};continue;}break;}this.executeBlock(program.lines[this.pc.index],this.pc,program);}
    if(this.execCount>=100000)this.warn('error',this.state.line,'Límite de ejecución excedido');return this;
  }
}
