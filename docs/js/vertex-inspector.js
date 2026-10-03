const t=value=>globalThis.CNCVexaI18n?.translateString(value)??value;
const visible=(sim,step)=>step.kind==='move'&&(step.type==='G00'?sim.showRapids:sim.showCuts);

export function segmentDistance(point,a,b){
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const progress=length?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length)):0;
  return Math.hypot(point.x-a.x-progress*dx,point.y-a.y-progress*dy);
}

export function drawPathHighlight(sim){
  const hit=sim.hoveredPath;if(!hit||sim.viewMode!=='2d'||sim.showToolpath===false)return;
  const c=sim.ctx,project=p=>sim.cfg.diameter!==undefined?sim.project2D(p.z,p.x/2):sim.project2D(p.x,p.y);
  c.save();c.setLineDash([]);c.lineCap='round';c.lineJoin='round';
  for(const [color,width] of [['rgba(255,174,0,.25)',8],['#e78b00',3]]){
    c.strokeStyle=color;c.lineWidth=width;c.beginPath();
    for(let i=hit.start;i<=hit.end;i++){
      const s=sim.path[i];if(!s||!visible(sim,s))continue;
      const a=project(s.from),b=project(s.to);c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);
    }
    c.stroke();
  }
  c.fillStyle='#ffcf45';c.strokeStyle='#a26300';c.lineWidth=1.5;
  for(const index of hit.vertices){const p=project(sim.path[index].to);c.beginPath();c.arc(p.x,p.y,4.5,0,Math.PI*2);c.fill();c.stroke();}
  c.restore();
}

export function bindVertexInspector(canvas,getSimulator){
  const tooltip=document.createElement('div');
  tooltip.className='vertex-tooltip hidden';tooltip.setAttribute('role','tooltip');document.body.append(tooltip);
  let pointer=null,frame=0,hoveredSimulator=null,cache=null;
  const setHit=(sim,hit)=>{
    if(hoveredSimulator&&hoveredSimulator!==sim){hoveredSimulator.hoveredPath=null;hoveredSimulator.draw?.();}
    hoveredSimulator=sim;
    const previous=sim.hoveredPath;
    if(previous?.index===hit?.index&&previous?.vertices.join(',')===hit?.vertices.join(','))return;
    sim.hoveredPath=hit;sim.draw?.();
  };
  const hide=()=>{pointer=null;tooltip.classList.add('hidden');if(hoveredSimulator)setHit(hoveredSimulator,null);};
  function screenIndex(sim){
    const signature=JSON.stringify([sim.w,sim.h,sim.camera,sim.twoDScale,sim.twoDRenderBounds,sim.cfg.diameter,sim.cfg.length,sim.cfg.stickout]);
    if(cache?.sim===sim&&cache.path===sim.path&&cache.signature===signature)return cache;
    const project=p=>sim.cfg.diameter!==undefined?sim.project2D(p.z,p.x/2):sim.project2D(p.x,p.y),bins=new Map(),cell=24,rect=canvas.getBoundingClientRect(),width=rect.width,height=rect.height;
    const add=(x,y,index)=>{const key=`${x}:${y}`;if(!bins.has(key))bins.set(key,new Set());bins.get(key).add(index);};
    const entries=(sim.path||[]).map((step,index)=>{
      if(step.kind!=='move')return null;
      const a=project(step.from||step.to),b=project(step.to),dx=b.x-a.x,dy=b.y-a.y;
      // Clip before indexing so a highly zoomed, long rapid stays inexpensive.
      let lo=0,hi=1;
      for(const [p,q] of [[-dx,a.x+12],[dx,width+12-a.x],[-dy,a.y+12],[dy,height+12-a.y]]){
        if(p===0){if(q<0){hi=-1;break;}continue;}
        const r=q/p;if(p<0)lo=Math.max(lo,r);else hi=Math.min(hi,r);
      }
      if(lo<=hi){
        const samples=Math.max(1,Math.ceil(Math.hypot(dx,dy)*(hi-lo)/cell));
        for(let j=0;j<=samples;j++){const t=lo+(hi-lo)*j/samples,x=Math.floor((a.x+dx*t)/cell),y=Math.floor((a.y+dy*t)/cell);for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++)add(x+ox,y+oy,index);}
      }
      return{step,index,a,b};
    });
    return cache={sim,path:sim.path,signature,bins,entries,cell};
  }
  function inspect(){
    frame=0;const sim=getSimulator();
    if(!pointer||sim.viewMode!=='2d'||sim.drag||sim.showToolpath===false){hide();return;}
    const rect=canvas.getBoundingClientRect(),p={x:pointer.x-rect.left,y:pointer.y-rect.top},index=screenIndex(sim);
    const candidates=[...(index.bins.get(`${Math.floor(p.x/index.cell)}:${Math.floor(p.y/index.cell)}`)||[])].map(i=>index.entries[i]).filter(item=>visible(sim,item.step));
    let nearest=9,points=[];
    for(const item of candidates){
      const distance=Math.hypot(p.x-item.b.x,p.y-item.b.y);
      if(distance<nearest-.5){nearest=distance;points=[item];}else if(distance<=nearest+.5&&distance<9)points.push(item);
    }
    const seen=new Set();points=points.filter(({step})=>{const key=[step.line,step.to.x,step.to.y||0,step.to.z].join(':');if(seen.has(key))return false;seen.add(key);return true;});
    points.sort((a,b)=>Math.abs(a.index-sim.current)-Math.abs(b.index-sim.current));
    let selected=points[0];
    if(!selected){
      nearest=7;
      for(const item of candidates){const distance=segmentDistance(p,item.a,item.b);if(distance<nearest-.1||(Math.abs(distance-nearest)<=.1&&selected&&Math.abs(item.index-sim.current)<Math.abs(selected.index-sim.current))){nearest=distance;selected=item;}}
    }
    if(!selected){tooltip.classList.add('hidden');setHit(sim,null);return;}
    let start=selected.index,end=start;
    const same=step=>step&&step.line===selected.step.line&&step.source===selected.step.source;
    while(start>0&&same(sim.path[start-1]))start--;while(end+1<sim.path.length&&same(sim.path[end+1]))end++;
    setHit(sim,{index:selected.index,start,end,vertices:points.map(item=>item.index)});
    tooltip.replaceChildren();
    for(const {step} of (points.length?points:[selected]).slice(0,6)){
      const item=document.createElement('div'),title=document.createElement('strong'),code=document.createElement('code'),coords=document.createElement('span');
      title.textContent=`${t('Línea')} ${step.line}`;code.textContent=step.source||step.type;
      coords.textContent=['X','Y','Z'].map(axis=>{const key=axis.toLowerCase(),value=Number(step.to[key]||0).toFixed(3);return points.length?`${axis} ${value}`:`${axis} ${Number(step.from[key]||0).toFixed(3)} → ${value}`;}).join('   ')+' mm';
      item.append(title,code,coords);tooltip.append(item);
    }
    if(points.length>6){const more=document.createElement('span');more.textContent=`+${points.length-6}`;tooltip.append(more);}
    tooltip.classList.remove('hidden');const size=tooltip.getBoundingClientRect();
    tooltip.style.left=`${Math.max(8,Math.min(innerWidth-size.width-8,pointer.x+12))}px`;tooltip.style.top=`${Math.max(8,pointer.y-size.height-14)}px`;
  }
  canvas.addEventListener('pointermove',event=>{if(event.pointerType==='touch'||event.buttons){hide();return;}pointer={x:event.clientX,y:event.clientY};if(!frame)frame=requestAnimationFrame(inspect);});
  canvas.addEventListener('pointerleave',hide);canvas.addEventListener('pointerdown',hide);canvas.addEventListener('wheel',hide);
  addEventListener('scroll',hide,true);addEventListener('resize',hide);return{hide};
}
