import {evaluateExpression,evaluateCondition} from './expression.js?v=5.6.0';

const stripComments=line=>line.replace(/\([^)]*\)/g,'').replace(/;.*/,'').trim().toUpperCase();
const unitFactor=state=>state.units==='G20'?25.4:1;
const canonicalG=raw=>{const [whole,decimal]=String(raw).split('.');return `G${whole.padStart(2,'0')}${decimal!==undefined?`.${decimal}`:''}`;};
const canonicalM=raw=>`M${String(raw).padStart(2,'0')}`;
const cloneState=s=>({...s,machine:{...s.machine},work:{...s.work},local:{...s.local},rotation:{...s.rotation,center:{...(s.rotation?.center||{x:0,y:0,z:0})}},polar:{...s.polar,center:{...(s.polar?.center||{x:0,y:0,z:0})}},cycle:s.cycle?{...s.cycle}:null});

export class CNCInterpreter{
  constructor(config={}){this.config=config;this.reset();}

  reset(){
    this.programs=new Map();this.variables=new Map();this.diagnostics=[];this.trace=[];this.steps=[];this.programOrder=[];
    this.state={
      machine:{x:0,y:0,z:100},work:{x:0,y:0,z:100},motion:'G00',distance:'G90',units:'G21',plane:'G17',feedMode:'G94',returnMode:'G98',
      wcs:'G54',local:{x:0,y:0,z:0},rotation:{active:false,plane:'G17',center:{x:0,y:0,z:0},r:0},polar:{active:false,plane:'G17',center:{x:0,y:0,z:0},radius:0,angle:0},feed:0,rpm:0,spindle:'OFF',coolant:'OFF',tool:0,h:0,d:0,
      toolComp:false,radiusComp:'G40',cycle:null,line:0,block:'—'
    };
    this.callStack=[];this.execCount=0;this.ended=false;
  }

  parse(source){
    this.reset();
    const raw=source.replace(/\r/g,'').split('\n');let current={id:'MAIN',lines:[]};this.programs.set('MAIN',current);
    raw.forEach((text,index)=>{
      const clean=stripComments(text),om=clean.match(/^O(\d+)/);
      if(om){current={id:String(Number(om[1])),lines:[]};this.programs.set(current.id,current);this.programOrder.push(current.id);}
      current.lines.push({text,clean,index:index+1});
    });
    for(const p of this.programs.values()){
      p.labels=new Map();p.whilePairs=new Map();const stack=[];
      p.lines.forEach((line,i)=>{
        const label=line.clean.match(/^N(\d+)/);if(label)p.labels.set(String(Number(label[1])),i);
        const wm=line.clean.match(/\bWHILE\s*\[.*?\]\s*DO(\d+)/);if(wm)stack.push({id:wm[1],i});
        const em=line.clean.match(/^END(\d+)/);if(em){
          let k=stack.length-1;while(k>=0&&stack[k].id!==em[1])k--;
          if(k>=0){const w=stack.splice(k,1)[0];p.whilePairs.set(w.i,i);p.whilePairs.set(i,w.i);}
          else this.warn('error',line.index,`END${em[1]} sin WHILE correspondiente`);
        }
      });
      stack.forEach(w=>this.warn('error',p.lines[w.i].index,`WHILE DO${w.id} sin END${w.id}`));
    }
    const main=this.programs.get('MAIN'),mainHasCode=main?.lines.some(line=>line.clean&&!/^O\d+/.test(line.clean));
    this.pc={program:mainHasCode?'MAIN':(this.programOrder[0]||'MAIN'),index:0};this.syncWork();return this;
  }

  warn(type,line,message){this.diagnostics.push({type,line,message});}
  getOffset(wcs=this.state.wcs){return this.config.offsets?.[wcs]||{x:0,y:0,z:0};}
  syncWork(){const o=this.getOffset(),l=this.state.local;this.state.work={x:this.state.machine.x-o.x-l.x,y:this.state.machine.y-o.y-l.y,z:this.state.machine.z-o.z-l.z};}
  wordValue(raw){return evaluateExpression(raw,this.variables);}

  parseWords(clean){
    const words={},re=/([A-Z])((?:#\[.*?\]|#\d+|\[[^\]]+\]|[+\-]?(?:\d+\.?\d*|\.\d+)))/g;let m;
    while((m=re.exec(clean))){
      try{words[m[1]]=this.wordValue(m[2].replace(/^\[|\]$/g,''));}
      catch(error){throw new Error(`${m[1]}: ${error.message}`);}
    }
    return words;
  }

  planeAxes(plane=this.state.plane){
    if(plane==='G18')return ['x','z'];
    if(plane==='G19')return ['y','z'];
    return ['x','y'];
  }

  rotatePoint(point,angleDeg,center,plane=this.state.plane){
    const [u,v]=this.planeAxes(plane),angle=angleDeg*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),du=point[u]-center[u],dv=point[v]-center[v],out={...point};
    out[u]=center[u]+du*c-dv*s;out[v]=center[v]+du*s+dv*c;return out;
  }

  currentCommandWork(){
    const o=this.getOffset(),l=this.state.local,physical={x:this.state.machine.x-o.x-l.x,y:this.state.machine.y-o.y-l.y,z:this.state.machine.z-o.z-l.z};
    return this.state.rotation.active?this.rotatePoint(physical,-this.state.rotation.r,this.state.rotation.center,this.state.rotation.plane):physical;
  }

  resolveTarget(words,machineBlock=false){
    const unit=unitFactor(this.state);
    if(machineBlock){
      const target={...this.state.machine};
      for(const axis of ['X','Y','Z'])if(words[axis]!==undefined)target[axis.toLowerCase()]=words[axis]*unit;
      return target;
    }
    const o=this.getOffset(),l=this.state.local,current=this.currentCommandWork();let command={...current};
    if(this.state.polar.active){
      if(this.state.polar.plane!=='G17')throw new Error('Esta versión simula G15/G16 polar en el plano G17 (XY)');
      let radius=this.state.polar.radius,angle=this.state.polar.angle;
      if(this.state.distance==='G91'){
        if(words.X!==undefined)radius+=words.X*unit;
        if(words.Y!==undefined)angle+=words.Y;
      }else{
        if(words.X!==undefined)radius=words.X*unit;
        if(words.Y!==undefined)angle=words.Y;
      }
      const rad=angle*Math.PI/180;
      if(words.X!==undefined||words.Y!==undefined){command.x=this.state.polar.center.x+radius*Math.cos(rad);command.y=this.state.polar.center.y+radius*Math.sin(rad);}
      if(words.Z!==undefined)command.z=this.state.distance==='G91'?current.z+words.Z*unit:words.Z*unit;
      this.state.polar.radius=radius;this.state.polar.angle=angle;
    }else{
      for(const axis of ['X','Y','Z'])if(words[axis]!==undefined){const k=axis.toLowerCase(),value=words[axis]*unit;command[k]=this.state.distance==='G91'?current[k]+value:value;}
    }
    if(this.state.rotation.active)command=this.rotatePoint(command,this.state.rotation.r,this.state.rotation.center,this.state.rotation.plane);
    return{x:command.x+o.x+l.x,y:command.y+o.y+l.y,z:command.z+o.z+l.z};
  }

  addMove(from,to,type,words,line,source,extra={}){
    const tool={diameter:10,length:50,type:'flat',name:'Cortador',angle:90,...(this.config.tools?.[this.state.tool]||{})},r=Math.max(.1,tool.diameter/2),b=this.config.stockBounds;
    const intersectsStock=b?Math.max(from.x,to.x)+r>=b.minX&&Math.min(from.x,to.x)-r<=b.maxX&&Math.max(from.y,to.y)+r>=b.minY&&Math.min(from.y,to.y)-r<=b.maxY&&Math.min(from.z,to.z)<=b.maxZ+r&&Math.max(from.z,to.z)>=b.minZ-r:Math.min(from.z,to.z)<=(this.config.stockTop??0)+1e-6;
    const cut=type!=='G00'&&intersectsStock;
    if(cut&&this.state.spindle==='OFF')this.warn('warning',line,'Movimiento de corte con el husillo apagado');
    if(type!=='G00'&&this.state.feed<=0)this.warn('warning',line,'Movimiento de corte sin avance F positivo');
    this.steps.push({kind:'move',from:{...from},to:{...to},type,line,source,feed:this.state.feed,rpm:this.state.rpm,tool:this.state.tool,diameter:tool.diameter,toolLength:tool.length,toolType:tool.type,toolName:tool.name,toolAngle:tool.angle,cut,...extra,state:cloneState(this.state)});
    this.state.machine={...to};this.syncWork();
  }

  arcPoints(from,to,cw,words){
    const planes={G17:{u:'x',v:'y',w:'z',iu:'I',iv:'J'},G18:{u:'x',v:'z',w:'y',iu:'I',iv:'K'},G19:{u:'y',v:'z',w:'x',iu:'J',iv:'K'}},pl=planes[this.state.plane]||planes.G17,unit=unitFactor(this.state);
    const fu=from[pl.u],fv=from[pl.v],tu=to[pl.u],tv=to[pl.v];let cu,cv,r;
    if(words[pl.iu]!==undefined||words[pl.iv]!==undefined){
      let offU=(words[pl.iu]||0)*unit,offV=(words[pl.iv]||0)*unit;
      if(this.state.rotation.active&&this.state.rotation.plane===this.state.plane){const a=this.state.rotation.r*Math.PI/180,c=Math.cos(a),s=Math.sin(a),ru=offU*c-offV*s,rv=offU*s+offV*c;offU=ru;offV=rv;}
      cu=fu+offU;cv=fv+offV;r=Math.hypot(offU,offV);
    }
    else if(words.R!==undefined){
      r=Math.abs(words.R)*unit;const du=tu-fu,dv=tv-fv,q=Math.hypot(du,dv);if(q<1e-9)throw new Error('Un arco completo requiere I/J/K, no R');if(q>2*r+1e-6)throw new Error('Radio R demasiado pequeño para el arco');
      const mu=(fu+tu)/2,mv=(fv+tv)/2,h=Math.sqrt(Math.max(0,r*r-q*q/4)),sign=(cw?-1:1)*(words.R<0?-1:1);cu=mu-sign*dv/q*h;cv=mv+sign*du/q*h;
    }else throw new Error(`Arco ${this.state.plane} sin ${pl.iu}/${pl.iv} o R`);
    if(r<1e-9)throw new Error('Radio de arco igual a cero');
    let a0=Math.atan2(fv-cv,fu-cu),a1=Math.atan2(tv-cv,tu-cu),sweep=a1-a0;if(cw&&sweep>=0)sweep-=Math.PI*2;if(!cw&&sweep<=0)sweep+=Math.PI*2;
    const count=Math.max(8,Math.ceil(Math.abs(sweep)*r/2)),points=[];
    for(let i=1;i<=count;i++){
      const t=i/count,a=a0+sweep*t,p={...from};p[pl.u]=cu+r*Math.cos(a);p[pl.v]=cv+r*Math.sin(a);p[pl.w]=from[pl.w]+(to[pl.w]-from[pl.w])*t;points.push(p);
    }
    return points;
  }

  setVar(line,pc){
    const m=line.clean.match(/^#(\d+|\[[^\]]+\])\s*=\s*(.+)$/);if(!m)return false;
    const id=m[1].startsWith('[')?Math.trunc(this.wordValue(m[1].slice(1,-1))):Number(m[1]),value=this.wordValue(m[2]);
    if(id===3000){this.warn('error',line.index,`Alarma Macro #3000 = ${value}`);this.ended=true;return true;}
    this.variables.set(id,value);this.trace.push(`L${line.index}: #${id} = ${value}`);pc.index++;return true;
  }

  applyG10(words,line){
    if(Math.trunc(words.L)!==2||words.P===undefined){
      const hasAxis=['X','Y','Z'].some(axis=>words[axis]!==undefined);
      this.warn('warning',line,hasAxis
        ?'G10 no es interpolación lineal: se usa para introducir offsets/datos. ¿Querías escribir G01? En esta versión, G10 L2 P1–P6 edita G54–G59.'
        :'G10 requiere una variante compatible. Esta versión admite G10 L2 P1–P6 para editar G54–G59.');
      return;
    }
    const p=Math.trunc(words.P);if(p<1||p>6){this.warn('warning',line,'G10 L2: esta versión edita P1–P6 (G54–G59)');return;}
    const key=`G${53+p}`,current=this.config.offsets?.[key]||{x:0,y:0,z:0},unit=unitFactor(this.state),next={...current};
    for(const a of ['X','Y','Z'])if(words[a]!==undefined)next[a.toLowerCase()]=words[a]*unit;
    if(!this.config.offsets)this.config.offsets={};this.config.offsets[key]=next;this.trace.push(`L${line}: ${key} = X${next.x} Y${next.y} Z${next.z}`);if(this.state.wcs===key)this.syncWork();
  }

  updateCycle(code,words,initialZ){
    const unit=unitFactor(this.state),o=this.getOffset(),l=this.state.local,old=this.state.cycle||{},cycle={...old,code,initialZ:old.code===code?old.initialZ:initialZ};
    for(const key of ['Q','P'])if(words[key]!==undefined)cycle[key.toLowerCase()]=words[key]*unit;
    if(this.state.distance==='G91'){
      if(words.R!==undefined)cycle.r=initialZ+words.R*unit;
      else if(cycle.r===undefined)cycle.r=initialZ;
      if(words.Z!==undefined)cycle.z=cycle.r+words.Z*unit;
    }else{
      if(words.R!==undefined)cycle.r=words.R*unit+o.z+l.z;
      else if(cycle.r===undefined)cycle.r=initialZ;
      if(words.Z!==undefined)cycle.z=words.Z*unit+o.z+l.z;
    }
    this.state.cycle=cycle;return cycle;
  }

  executeCycle(words,line,source,explicitCode=null){
    const from={...this.state.machine},code=explicitCode||this.state.cycle?.code;if(!code)return false;
    const cycle=this.updateCycle(code,words,from.z),xyWords={};if(words.X!==undefined)xyWords.X=words.X;if(words.Y!==undefined)xyWords.Y=words.Y;
    const xy=this.resolveTarget(xyWords,false);xy.z=from.z;
    if(Math.hypot(xy.x-from.x,xy.y-from.y)>1e-9)this.addMove(from,xy,'G00',words,line,source,{cycle:code});
    let pos={...this.state.machine},r=cycle.r??pos.z,z=cycle.z;
    if(z===undefined)throw new Error(`${code} requiere Z`);
    if(Math.abs(pos.z-r)>1e-9){const to={...pos,z:r};this.addMove(pos,to,'G00',words,line,source,{cycle:code});pos={...to};}
    const feedDown=target=>{this.addMove(pos,{...pos,z:target},'G01',words,line,source,{cycle:code});pos={...pos,z:target};};
    if(code==='G73'||code==='G83'){
      const q=Math.max(.001,Math.abs(cycle.q||0));if(!cycle.q)throw new Error(`${code} requiere Q`);
      const direction=z<r?-1:1;let level=r;
      while((direction<0&&level>z)||(direction>0&&level<z)){
        const next=direction<0?Math.max(z,level-q):Math.min(z,level+q);feedDown(next);level=next;
        if(level!==z){const retract=code==='G83'?r:level-direction*Math.min(1,q*.2);const up={...pos,z:retract};this.addMove(pos,up,'G00',words,line,source,{cycle:code});pos=up;if(code==='G83'){const near={...pos,z:level-direction*Math.min(1,q*.15)};this.addMove(pos,near,'G00',words,line,source,{cycle:code});pos=near;}}
      }
    }else feedDown(z);
    if(['G82','G88','G89'].includes(code)&&cycle.p)this.trace.push(`L${line}: permanencia P${cycle.p}`);
    const returnZ=this.state.returnMode==='G99'?r:cycle.initialZ;
    if(['G74','G84','G85','G89'].includes(code))this.addMove(pos,{...pos,z:returnZ},'G01',words,line,source,{cycle:code});
    else this.addMove(pos,{...pos,z:returnZ},'G00',words,line,source,{cycle:code});
    return true;
  }

  executeLine(){
    if(this.ended)return null;
    if(this.execCount++>100000){this.warn('error',this.state.line,'Límite de 100 000 bloques: posible bucle infinito');this.ended=true;return null;}
    const program=this.programs.get(this.pc.program);
    if(!program||this.pc.index>=program.lines.length){if(this.callStack.length){this.pc=this.callStack.pop();return {kind:'control'};}this.ended=true;return null;}
    const pc={...this.pc},line=program.lines[pc.index];this.state.line=line.index;this.state.block=line.clean||'(vacío)';
    if(!line.clean||/^O\d+/.test(line.clean)||/^N\d+\s*$/.test(line.clean)){this.pc.index++;return {kind:'control',line:line.index};}

    try{
      if(this.setVar(line,this.pc))return {kind:'variable',line:line.index};
      let m=line.clean.match(/^IF\s*\[(.*?)\]\s*THEN\s*(#.+)$/);
      if(m){if(evaluateCondition(m[1],this.variables)){const fake={...line,clean:m[2]};this.setVar(fake,this.pc);}else this.pc.index++;return {kind:'control',line:line.index};}
      m=line.clean.match(/^IF\s*\[(.*?)\]\s*GOTO\s*(\d+)/);
      if(m){if(evaluateCondition(m[1],this.variables)){const dest=program.labels.get(String(Number(m[2])));if(dest===undefined)throw new Error(`No existe N${m[2]}`);this.pc.index=dest;}else this.pc.index++;return {kind:'control',line:line.index};}
      m=line.clean.match(/^GOTO\s*(\d+)/);
      if(m){const dest=program.labels.get(String(Number(m[1])));if(dest===undefined)throw new Error(`No existe N${m[1]}`);this.pc.index=dest;return {kind:'control',line:line.index};}
      m=line.clean.match(/\bWHILE\s*\[(.*?)\]\s*DO(\d+)/);
      if(m){if(evaluateCondition(m[1],this.variables))this.pc.index++;else{const end=program.whilePairs.get(pc.index);if(end===undefined)throw new Error(`DO${m[2]} sin END${m[2]}`);this.pc.index=end+1;}return {kind:'control',line:line.index};}
      m=line.clean.match(/^END(\d+)/);
      if(m){const start=program.whilePairs.get(pc.index);if(start===undefined)throw new Error(`END${m[1]} sin WHILE`);this.pc.index=start;return {kind:'control',line:line.index};}

      const words=this.parseWords(line.clean),gCodes=[...line.clean.matchAll(/G(\d+(?:\.\d+)?)/g)].map(x=>canonicalG(x[1])),mCodes=[...line.clean.matchAll(/M(\d+)/g)].map(x=>canonicalM(x[1])),hasG53=gCodes.includes('G53');
      const cycleCode=gCodes.find(g=>['G73','G74','G76','G81','G82','G83','G84','G85','G86','G87','G88','G89'].includes(g));

      for(const g of gCodes){
        if(['G00','G01','G02','G03'].includes(g)){this.state.motion=g;this.state.cycle=null;}
        else if(['G17','G18','G19'].includes(g))this.state.plane=g;
        else if(['G20','G21'].includes(g))this.state.units=g;
        else if(['G90','G91'].includes(g))this.state.distance=g;
        else if(['G94','G95'].includes(g))this.state.feedMode=g;
        else if(['G98','G99'].includes(g))this.state.returnMode=g;
        else if(['G54','G55','G56','G57','G58','G59'].includes(g)){this.state.wcs=g;this.syncWork();}
        else if(g==='G54.1'){this.state.wcs=`G54.1 P${Math.max(1,Math.trunc(words.P||1))}`;this.syncWork();}
        else if(['G40','G41','G42'].includes(g))this.state.radiusComp=g;
        else if(g==='G43'){this.state.toolComp=true;if(words.H!==undefined)this.state.h=Math.trunc(words.H);}
        else if(g==='G49')this.state.toolComp=false;
        else if(g==='G52'){for(const a of ['X','Y','Z'])if(words[a]!==undefined)this.state.local[a.toLowerCase()]=words[a]*unitFactor(this.state);this.syncWork();}
        else if(g==='G16'){
          if(this.state.plane!=='G17')this.warn('warning',line.index,'G16 polar se simula actualmente en G17 (plano XY)');
          const current=this.currentCommandWork(),unit=unitFactor(this.state),center={x:words.X!==undefined?words.X*unit:0,y:words.Y!==undefined?words.Y*unit:0,z:current.z},dx=current.x-(words.X!==undefined?words.X*unit:0),dy=current.y-(words.Y!==undefined?words.Y*unit:0);
          this.state.polar={active:true,plane:this.state.plane,center,radius:Math.hypot(dx,dy),angle:Math.atan2(dy,dx)*180/Math.PI};
        }
        else if(g==='G15')this.state.polar.active=false;
        else if(g==='G68'){
          const current=this.currentCommandWork(),plane=this.state.plane,[u,v]=this.planeAxes(plane),unit=unitFactor(this.state),center={...current};
          const addr={G17:['X','Y'],G18:['X','Z'],G19:['Y','Z']}[plane]||['X','Y'];
          for(const [axis,letter] of [[u,addr[0]],[v,addr[1]]])if(words[letter]!==undefined)center[axis]=this.state.distance==='G91'?current[axis]+words[letter]*unit:words[letter]*unit;
          const previous=this.state.rotation.active?this.state.rotation.r:0,angle=words.R!==undefined?(this.state.distance==='G91'?previous+words.R:words.R):previous;
          this.state.rotation={active:true,plane,center,r:angle};
        }
        else if(g==='G69')this.state.rotation.active=false;
        else if(g==='G80')this.state.cycle=null;
        else if(g==='G10')this.applyG10(words,line.index);
        else if(g==='G92'){
          const o=this.getOffset(),unit=unitFactor(this.state);for(const a of ['X','Y','Z'])if(words[a]!==undefined){const k=a.toLowerCase();this.state.local[k]=this.state.machine[k]-o[k]-words[a]*unit;}this.syncWork();
        }
      }

      if(words.F!==undefined)this.state.feed=words.F*unitFactor(this.state);if(words.S!==undefined)this.state.rpm=words.S;if(words.T!==undefined)this.state.tool=Math.trunc(words.T);if(words.H!==undefined)this.state.h=Math.trunc(words.H);if(words.D!==undefined)this.state.d=Math.trunc(words.D);
      for(const mc of mCodes){if(mc==='M03')this.state.spindle='CW';else if(mc==='M04')this.state.spindle='CCW';else if(mc==='M05')this.state.spindle='OFF';else if(mc==='M07')this.state.coolant='MIST';else if(mc==='M08')this.state.coolant='ON';else if(mc==='M09')this.state.coolant='OFF';}

      if(gCodes.includes('G65')){
        const target=String(Math.trunc(words.P||0));if(!this.programs.has(target))throw new Error(`No existe macro O${target}`);
        const args={A:1,B:2,C:3,I:4,J:5,K:6,D:7,E:8,F:9,H:11,M:13,Q:17,R:18,S:19,T:20,U:21,V:22,W:23,X:24,Y:25,Z:26};for(const [word,id] of Object.entries(args))if(words[word]!==undefined)this.variables.set(id,words[word]);
        this.callStack.push({program:pc.program,index:pc.index+1});this.pc={program:target,index:0};return {kind:'call',line:line.index};
      }
      if(mCodes.includes('M98')){
        const target=String(Math.trunc(words.P||0)),times=Math.max(1,Math.trunc(words.L||1));if(!this.programs.has(target))throw new Error(`No existe subprograma O${target}`);
        this.callStack.push({program:pc.program,index:pc.index+1,repeat:{target,remaining:times-1}});this.pc={program:target,index:0};return {kind:'call',line:line.index};
      }
      if(mCodes.includes('M99')){
        const ret=this.callStack.pop();if(!ret){this.ended=true;return {kind:'end',line:line.index};}
        if(ret.repeat?.remaining>0){ret.repeat.remaining--;this.callStack.push(ret);this.pc={program:ret.repeat.target,index:0};}else this.pc={program:ret.program,index:ret.index};return {kind:'return',line:line.index};
      }
      if(mCodes.includes('M30')||mCodes.includes('M02')){this.ended=true;this.pc.index++;return {kind:'end',line:line.index};}
      if(gCodes.includes('G04'))this.trace.push(`L${line.index}: permanencia ${words.P!==undefined?`P${words.P}`:words.X!==undefined?`X${words.X}`:''}`);
      const explicitMotion=gCodes.some(g=>['G00','G01','G02','G03'].includes(g));
      const parameterOnly=gCodes.some(g=>['G04','G10','G16','G50','G50.1','G51','G51.1','G52','G68','G68.2','G92'].includes(g));
      if(parameterOnly&&!explicitMotion&&!cycleCode){this.pc.index++;return {kind:'state',line:line.index};}
      if(gCodes.includes('G28')){
        const from={...this.state.machine},mid=this.resolveTarget(words,false);this.addMove(from,mid,'G00',words,line.index,line.clean,{reference:true});const home={...mid};for(const a of ['X','Y','Z'])if(words[a]!==undefined)home[a.toLowerCase()]=0;this.addMove(mid,home,'G00',words,line.index,line.clean,{reference:true});this.pc.index++;return this.steps.at(-1);
      }

      const hasXY=words.X!==undefined||words.Y!==undefined;
      if(cycleCode||(this.state.cycle&&hasXY)){
        this.executeCycle(words,line.index,line.clean,cycleCode);this.pc.index++;return this.steps.at(-1)||{kind:'state',line:line.index};
      }

      const motionWords=['X','Y','Z'].some(a=>words[a]!==undefined),motion=this.state.motion;
      const planeCenterWords={G17:['I','J'],G18:['I','K'],G19:['J','K']}[this.state.plane]||['I','J'];
      const fullCircle=(motion==='G02'||motion==='G03')&&!motionWords&&planeCenterWords.some(a=>words[a]!==undefined);
      if(motionWords||fullCircle){
        const from={...this.state.machine},to=fullCircle?{...from}:this.resolveTarget(words,hasG53);
        if(motion==='G02'||motion==='G03'){let prev=from;for(const point of this.arcPoints(from,to,motion==='G02',words)){this.addMove(prev,point,motion,words,line.index,line.clean,{arc:true,plane:this.state.plane,fullCircle});prev=point;}}
        else this.addMove(from,to,motion,words,line.index,line.clean,{plane:this.state.plane});
      }
      this.pc.index++;return {kind:'state',line:line.index};
    }catch(error){this.warn('error',line.index,error.message);this.trace.push(`ALARMA L${line.index}: ${error.message}`);this.pc.index++;return {kind:'error',line:line.index,message:error.message};}
  }

  compile(max=100000){let n=0;while(!this.ended&&n++<max)this.executeLine();return this;}
}
