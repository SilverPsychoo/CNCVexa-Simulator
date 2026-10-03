const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const steel=[.66,.73,.78],carbide=[.83,.66,.22],body=[.28,.34,.39],groove=[.36,.42,.45];
function normal(a,b,c){const u=b.map((v,i)=>v-a[i]),v=c.map((x,i)=>x-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...n)||1;return n.map(v=>v/l);}
function tri(data,a,b,c,color,n=null){n??=normal(a,b,c);for(const p of [a,b,c])data.push(...p,...n,...color);}
function box(data,x0,x1,y0,y1,z0,z1,color){
  const p=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
  for(const [a,b,c,d] of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]]){tri(data,p[a],p[b],p[c],color);tri(data,p[a],p[c],p[d],color);}
}

// All dimensions are millimetres; Z0 is the cutting tip, as in the cut kernel.
export function cutterDimensions(tool={}){
  const diameter=Math.max(.2,Number(tool.diameter)||3),length=Math.max(.2,Number(tool.length)||45),r=diameter/2,type=tool.type||'flat';
  const angle=clamp(Number(tool.angle)||(type==='drill'?118:90),10,178);
  const tipHeight=type==='ball'?Math.min(r,length):type==='drill'||type==='chamfer'?Math.min(length,r/Math.tan(angle*Math.PI/360)):0;
  const cuttingLength=clamp(Number(tool.cuttingLength)||Math.max(diameter*(type==='drill'?4:2.5),length*(type==='drill'?.55:.28)),tipHeight,Math.max(tipHeight,length*.82));
  const flutes=clamp(Math.round(Number(tool.flutes)||(type==='drill'||type==='ball'||diameter<=6?2:type==='chamfer'?3:4)),1,12);
  return{type,diameter,r,length,angle,tipHeight,cuttingLength,flutes,helix:clamp(Number(tool.helixAngle)||30,0,60)*Math.PI/180};
}

export function buildCutterMesh(tool={},segments=48){
  segments=Math.max(12,Math.round(segments));
  const d=cutterDimensions(tool),{type,r,length,tipHeight,cuttingLength,flutes}=d,data=[];
  // A revolved, genuinely recessed flute surface, rather than painted strips.
  function revolve(profile,cut=false){
    const point=(ring,theta)=>{
      const [radius,z]=ring,fade=cut?clamp((cuttingLength-z)/Math.max(.2,r*.45),0,1):0;
      const phase=flutes*(theta-z*Math.tan(type==='chamfer'?0:d.helix)/Math.max(.1,r));
      const recess=fade*(type==='drill'?.42:.27)*Math.pow((1+Math.cos(phase))/2,5);
      return [radius*(1-recess)*Math.cos(theta),radius*(1-recess)*Math.sin(theta),z];
    };
    for(let j=0;j<profile.length-1;j++)for(let i=0;i<segments;i++){
      const a=i/segments*TAU,b=(i+1)/segments*TAU,p=point(profile[j],a),q=point(profile[j],b),s=point(profile[j+1],b),t=point(profile[j+1],a);
      const ring=profile[j],outer=ring[0],valley=outer>0&&Math.hypot(...p.slice(0,2))<outer*.86;
      const color=valley?groove:ring[2];tri(data,p,q,s,color);tri(data,p,s,t,color);
    }
    for(const [ring,direction] of [[profile[0],-1],[profile.at(-1),1]])for(let i=0;i<segments;i++){
      const a=point(ring,i/segments*TAU),b=point(ring,(i+1)/segments*TAU);tri(data,[0,0,ring[1]],direction>0?a:b,direction>0?b:a,ring[2],[0,0,direction]);
    }
  }
  if(type==='face'){
    const height=Math.min(length*.35,Math.max(4,r*.3)),neck=Math.min(r*.4,Math.max(3,r*.25)),teeth=clamp(Math.round(d.diameter/10),4,12);
    revolve([[r*.94,Math.min(1,height*.2),body],[r*.94,height,body],[neck,height,steel],[neck,length,steel]]);
    for(let tooth=0;tooth<teeth;tooth++){
      const a=tooth/teeth*TAU,b=a+TAU/teeth*.24,xy=(rad,theta,z)=>[rad*Math.cos(theta),rad*Math.sin(theta),z];
      const p=[xy(r*.72,a,0),xy(r,b,0),xy(r,b,height*.65),xy(r*.72,a,height*.65),xy(r,a,0),xy(r*.72,b,0),xy(r*.72,b,height*.65),xy(r,a,height*.65)];
      for(const [i,j,k,l] of [[0,5,1,4],[3,7,2,6],[0,4,7,3],[5,6,2,1],[4,1,2,7],[0,3,6,5]]){tri(data,p[i],p[j],p[k],carbide);tri(data,p[i],p[k],p[l],carbide);}
    }
  }else{
    const profile=[],axial=Math.max(8,Math.round(segments*.75));
    if(type==='ball'){
      const rings=Math.max(5,Math.round(segments/4));for(let i=0;i<=rings;i++){const a=i/rings*Math.PI/2;profile.push([r*Math.sin(a),tipHeight*(1-Math.cos(a)),carbide]);}
    }else if(type==='drill'||type==='chamfer'){
      const rings=Math.max(3,Math.round(segments/8));for(let i=0;i<=rings;i++)profile.push([r*i/rings,tipHeight*i/rings,type==='drill'?steel:carbide]);
    }else profile.push([r,0,carbide]);
    const end=type==='chamfer'?Math.max(tipHeight,Math.min(cuttingLength,tipHeight+r*.3)):cuttingLength;
    for(let i=1;i<=axial;i++)profile.push([r,tipHeight+(end-tipHeight)*i/axial,type==='drill'?steel:carbide]);
    revolve(profile,true);
    const shank=type==='chamfer'?r*.48:r;
    revolve([[r,end,steel],[shank,Math.min(length,end+Math.min(r,length*.08)),steel],[shank,length,steel]]);
  }
  return new Float32Array(data);
}

// Lathe local coordinates: X along the spindle, Y radial, Z across the insert.
export function buildLatheCutterMesh(tool={},segments=48){
  const type=tool.type||'od',width=Math.max(.2,Number(tool.insertWidth)||6),nose=Math.max(0,Number(tool.noseRadius)||0),data=[];
  if(type==='drill'){
    const mesh=buildCutterMesh({type:'drill',diameter:width,length:Math.max(30,width*5.4),angle:118},segments);
    for(let i=0;i<mesh.length;i+=9)data.push(mesh[i+2],mesh[i],mesh[i+1],mesh[i+5],mesh[i+3],mesh[i+4],...mesh.slice(i+6,i+9));
    return new Float32Array(data);
  }
  const size=type==='thread'?Math.max(width,nose*4):Math.max(width,nose*2),thickness=Math.max(.4,size*.24);
  let outline;
  if(type==='groove')outline=[[-width/2,0],[width/2,0],[width/2,size*2],[-width/2,size*2]];
  else if(type==='thread')outline=[[0,0],[size/2,size*Math.sqrt(3)/2],[-size/2,size*Math.sqrt(3)/2]];
  else{
    const angle=(type==='finish'?55:80)*Math.PI/180,side=size/Math.sin(angle);
    outline=[[0,0],[side,0],[side*(1+Math.cos(angle)),side*Math.sin(angle)],[side*Math.cos(angle),side*Math.sin(angle)]];
  }
  // Round polygon corners by the configured nose radius, keeping the cutting
  // extremum at the programmed tip. Small grooves retain their actual width.
  if(nose>0&&type!=='groove'){
    const rounded=[],steps=Math.max(2,Math.round(segments/12));
    for(let i=0;i<outline.length;i++){
      const p=outline[i],a=outline[(i+outline.length-1)%outline.length],b=outline[(i+1)%outline.length],la=Math.hypot(a[0]-p[0],a[1]-p[1]),lb=Math.hypot(b[0]-p[0],b[1]-p[1]),u=[(a[0]-p[0])/la,(a[1]-p[1])/la],v=[(b[0]-p[0])/lb,(b[1]-p[1])/lb];
      const angle=Math.acos(clamp(u[0]*v[0]+u[1]*v[1],-1,1)),distance=Math.min(nose/Math.tan(angle/2),la*.35,lb*.35),a0=[p[0]+u[0]*distance,p[1]+u[1]*distance],b0=[p[0]+v[0]*distance,p[1]+v[1]*distance];
      const radius=distance*Math.tan(angle/2),bisector=[u[0]+v[0],u[1]+v[1]],bl=Math.hypot(...bisector),center=[p[0]+bisector[0]/bl*radius/Math.sin(angle/2),p[1]+bisector[1]/bl*radius/Math.sin(angle/2)],a1=Math.atan2(a0[1]-center[1],a0[0]-center[0]);
      let sweep=Math.atan2(b0[1]-center[1],b0[0]-center[0])-a1;if(sweep>Math.PI)sweep-=TAU;if(sweep< -Math.PI)sweep+=TAU;
      for(let j=0;j<=steps;j++){const a=a1+sweep*j/steps;rounded.push([center[0]+radius*Math.cos(a),center[1]+radius*Math.sin(a)]);}
    }
    if(type==='thread'){
      const minY=Math.min(...rounded.map(p=>p[1])),tipX=rounded.reduce((a,p)=>p[1]<a[1]?p:a)[0];outline=rounded.map(p=>[p[0]-tipX,p[1]-minY]);
    }else{
      const minX=Math.min(...rounded.map(p=>p[0])),tipY=rounded.reduce((a,p)=>p[0]<a[0]?p:a)[1];outline=rounded.map(p=>[p[0]-minX,p[1]-tipY]);
    }
  }
  const color=type==='thread'?[.92,.65,.26]:carbide;
  const lower=outline.map(([x,y])=>[x,y,-thickness]),upper=outline.map(([x,y])=>[x,y,0]);
  for(let i=1;i<outline.length-1;i++){tri(data,upper[0],upper[i],upper[i+1],color);tri(data,lower[0],lower[i+1],lower[i],color);}
  for(let i=0;i<outline.length;i++){const j=(i+1)%outline.length;tri(data,lower[i],lower[j],upper[j],color);tri(data,lower[i],upper[j],upper[i],color);}
  const holder=Math.max(3,width*1.35),start=size*.8,length=Math.max(25,width*5.5);
  if(type==='boring'){
    const shaft=buildCutterMesh({diameter:holder,length,type:'flat',cuttingLength:.01},segments);
    for(let i=0;i<shaft.length;i+=27){const points=[0,9,18].map(k=>[start+shaft[i+k+2],size*.8+shaft[i+k],-holder*.55+shaft[i+k+1]]);tri(data,...points,steel);}
  }else if(type==='groove')box(data,-width/2,width/2,start,length,-holder,-thickness,body);
  else if(type==='thread')box(data,-holder/2,holder/2,start,length,-holder,-thickness,steel);
  else box(data,start,length,size*.15,size*.15+holder,-holder,-thickness,steel);
  // Centre screw on the insert top, kept clear of the cutting nose.
  const cx=outline.reduce((s,p)=>s+p[0],0)/outline.length,cy=outline.reduce((s,p)=>s+p[1],0)/outline.length,screw=Math.min(size*.13,.8);
  for(let i=0;i<segments;i++){const a=i/segments*TAU,b=(i+1)/segments*TAU;tri(data,[cx,cy,.025],[cx+screw*Math.cos(a),cy+screw*Math.sin(a),.025],[cx+screw*Math.cos(b),cy+screw*Math.sin(b),.025],body);}
  return new Float32Array(data);
}
