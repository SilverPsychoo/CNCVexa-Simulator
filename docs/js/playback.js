// Coordinates are compiled in millimetres; F retains the program's unit.
export function speedMultiplier(value){
  return Math.pow(1000,(Math.max(1,Math.min(100,Number(value)||1))-1)/99);
}

export function movementDuration(step,machine='mill'){
  if(step.kind==='toolchange')return 1000;
  if(step.kind!=='move')return 0;
  const a=step.from,b=step.to,radial=machine==='lathe'? .5:1;
  const length=Math.hypot((b.x-a.x)*radial,(b.y||0)-(a.y||0),b.z-a.z);
  if(length<1e-9)return 0;
  // G00 is independent of F. This machine model uses 12 m/min rapids.
  let rate=12000;
  if(step.type!=='G00'){
    const unit=step.state?.units==='G20'?25.4:1;
    rate=Math.max(0,Number(step.feed)||0)*unit;
    if(step.state?.feedMode==='G95')rate*=Math.max(0,Number(step.rpm)||0);
    if(step.thread?.pitch)rate=Number(step.thread.pitch)*Math.max(0,Number(step.rpm)||0);
    // Programs lacking F already produce an interpreter warning.
    if(rate<=0)rate=100;
  }
  return length/rate*60000;
}

export function interpolateStep(step,progress){
  const p=Math.max(0,Math.min(1,progress)),to={};
  for(const axis of ['x','y','z'])if(step.from?.[axis]!==undefined||step.to?.[axis]!==undefined)
    to[axis]=(step.from?.[axis]||0)+((step.to?.[axis]||0)-(step.from?.[axis]||0))*p;
  return {...step,to};
}

export function blockEndIndex(steps,start){
  if(start<0||start>=steps.length)return steps.length-1;
  let end=start;
  while(end+1<steps.length&&steps[end+1].line===steps[start].line&&steps[end+1].source===steps[start].source)end++;
  return end;
}
