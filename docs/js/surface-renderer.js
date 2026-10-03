import {buildCutterMesh} from './cutter-mesh.js';
export {buildCutterMesh} from './cutter-mesh.js';
const TAU=Math.PI*2;
const vertex=`#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
uniform mat4 uProjection;
uniform sampler2D uMaterial;
uniform int uMode;
uniform vec3 uOrigin;
uniform vec2 uSize;
uniform float uResolution;
uniform float uHeight;
uniform vec3 uOffset;
out vec3 vNormal;
out vec3 vColor;
out vec3 vPosition;
out float vRemoved;
float depthAt(ivec2 p){return texelFetch(uMaterial,clamp(p,ivec2(0),textureSize(uMaterial,0)-1),0).r;}
void main(){
  vec3 p=aPosition,n=aNormal;vRemoved=0.0;
  if(uMode==0){
    ivec2 cell=ivec2(aPosition.xy);float depth=depthAt(cell);
    p=vec3(uOrigin.xy+min(aPosition.xy*uResolution,uSize),uOrigin.z-depth);
    if(aPosition.z>0.5)p.z=uOrigin.z-uHeight;
    if(aNormal.z>0.5){
      float dx=(depthAt(cell+ivec2(1,-1))+2.0*depthAt(cell+ivec2(1,0))+depthAt(cell+ivec2(1,1))-depthAt(cell+ivec2(-1,-1))-2.0*depthAt(cell-ivec2(1,0))-depthAt(cell+ivec2(-1,1)))/(8.0*uResolution);
      float dy=(depthAt(cell+ivec2(-1,1))+2.0*depthAt(cell+ivec2(0,1))+depthAt(cell+ivec2(1,1))-depthAt(cell+ivec2(-1,-1))-2.0*depthAt(cell-ivec2(0,1))-depthAt(cell+ivec2(1,-1)))/(8.0*uResolution);
      n=normalize(vec3(dx,dy,1.0));vRemoved=depth>=uHeight-0.025?1.0:0.0;
    }
  }else if(uMode==2){
    int i=int(aPosition.x);bool inner=aPosition.z==1.0||aPosition.z==3.0;
    int row=inner?1:0;float radius=depthAt(ivec2(i,row));float theta=aPosition.y;
    p=vec3(-min(float(i)*uResolution,uSize.x),radius*cos(theta),radius*sin(theta));
    float slope=(depthAt(ivec2(i+1,row))-depthAt(ivec2(i-1,row)))/(2.0*uResolution);
    n=normalize(vec3(slope,cos(theta),sin(theta)))*(inner?-1.0:1.0);
    if(aPosition.z>=2.0)n=vec3(1.0,0.0,0.0);
  }else p+=uOffset;
  vNormal=n;vColor=aColor;vPosition=p;gl_Position=uProjection*vec4(p,1.0);
}`;
const fragment=`#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vColor;
in vec3 vPosition;
in float vRemoved;
uniform float uLit;
uniform float uSmooth;
out vec4 color;
void main(){
  if(vRemoved>0.999)discard;
  vec3 n=normalize(vNormal);
  if(uSmooth<0.5){vec3 face=cross(dFdx(vPosition),dFdy(vPosition));if(length(face)>0.00001){face=normalize(face);n=dot(face,n)<0.0?-face:face;}}
  float light=0.64+0.40*max(0.0,dot(n,normalize(vec3(-0.34,-0.42,0.84))));
  float highlight=pow(max(0.0,dot(n,normalize(vec3(-0.2,-0.35,1.0)))),28.0)*0.09;
  color=vec4(mix(vColor,vColor*light+vec3(highlight),uLit),1.0);
}`;
function normal(a,b,c){const u=b.map((v,i)=>v-a[i]),v=c.map((x,i)=>x-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...n)||1;return n.map(v=>v/l);}
function triangle(data,a,b,c,color,n=null){n??=normal(a,b,c);for(const p of [a,b,c])data.push(...p,...n,...color);}


function orthographic(sim){
  const {right:r,up:u,dir:d}=sim.basis(),c=sim.renderCenter,s=sim.renderScale,w=sim.w,h=sim.h,far=Math.max(5000,Math.max(sim.cfg.x,sim.cfg.y,sim.cfg.z)*4);
  return new Float32Array([r.x*2*s/w,u.x*2*s/h,-d.x/far,0,r.y*2*s/w,u.y*2*s/h,-d.y/far,0,r.z*2*s/w,u.z*2*s/h,-d.z/far,0,-(c.x*r.x+c.y*r.y+c.z*r.z)*2*s/w+2*sim.camera.panX/w,-(c.x*u.x+c.y*u.y+c.z*u.z)*2*s/h-2*sim.camera.panY/h,(c.x*d.x+c.y*d.y+c.z*d.z)/far,1]);
}
function perspective(sim,world=true){
  const f=1/Math.tan(sim.camera.fov/2),aspect=sim.w/sim.h,n=sim.camera.near,far=Math.max(10000,sim.camera.fitDistance*10),a=(far+n)/(far-n),b=-2*far*n/(far-n),px=2*sim.camera.panX/sim.w,py=-2*sim.camera.panY/sim.h;
  if(!world)return new Float32Array([f/aspect,0,0,0,0,f,0,0,px,py,a,1,0,0,b,0]);
  const {right:r,up:u,forward:d,position:p}=sim.activeFrame||sim.updateCameraPose(),dot=v=>p.x*v.x+p.y*v.y+p.z*v.z;
  return new Float32Array([f/aspect*r.x+px*d.x,f*u.x+py*d.x,a*d.x,d.x,f/aspect*r.y+px*d.y,f*u.y+py*d.y,a*d.y,d.y,f/aspect*r.z+px*d.z,f*u.z+py*d.z,a*d.z,d.z,-f/aspect*dot(r)-px*dot(d),-f*dot(u)-py*dot(d),b-a*dot(d),-dot(d)]);
}

export class SurfaceRenderer{
  constructor(){
    this.available=false;
    if(typeof document==='undefined')return;
    this.canvas=document.createElement('canvas');
    try{
      const gl=this.gl=this.canvas.getContext('webgl2',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true});
      if(!gl)return;
      const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
      this.program=gl.createProgram();gl.attachShader(this.program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(this.program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(this.program);
      if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));
      this.uniforms={};for(const name of ['uProjection','uMaterial','uMode','uOrigin','uSize','uResolution','uHeight','uOffset','uLit','uSmooth'])this.uniforms[name]=gl.getUniformLocation(this.program,name);
      this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      this.dynamic=gl.createBuffer();this.available=true;
      this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.available=false;});
      this.canvas.addEventListener('webglcontextrestored',()=>{this.available=false;});
    }catch(error){this.available=false;}
  }
  begin(sim){
    const gl=this.gl;
    if(!this.available||gl.isContextLost())return false;
    if(this.canvas.width!==sim.canvas.width||this.canvas.height!==sim.canvas.height){this.canvas.width=sim.canvas.width;this.canvas.height=sim.canvas.height;}
    gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.useProgram(this.program);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(this.uniforms.uMaterial,0);gl.uniform3f(this.uniforms.uOffset,0,0,0);gl.uniform1f(this.uniforms.uResolution,sim.cfg.resolution);gl.uniform1f(this.uniforms.uSmooth,sim.renderQuality==='low'?0:1);return true;
  }
  attributes(buffer){
    const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
    for(let i=0;i<3;i++){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,3,gl.FLOAT,false,36,i*12);}
  }
  uploadMesh(vertices,indices){
    const gl=this.gl,buffer=gl.createBuffer(),index=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,index);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);return{buffer,index,count:indices.length};
  }
  disposeMesh(mesh){if(mesh){this.gl.deleteBuffer(mesh.buffer);this.gl.deleteBuffer(mesh.index);}}
  millMesh(sim){
    const q=sim.displayQualitySettings(),cells=(sim.nx-1)*(sim.ny-1),stride=sim.renderQuality==='ultra'?1:Math.max(1,Math.ceil(Math.sqrt(cells/q.tileBudget)));
    const key=['mill',sim.nx,sim.ny,stride].join(':');if(this.meshKey===key)return;
    this.disposeMesh(this.mesh);const data=[],indices=[],gold=[.84,.68,.25];
    const axis=count=>{const values=[];for(let i=0;i<count-1;i+=stride)values.push(i);values.push(count-1);return values;},xs=axis(sim.nx),ys=axis(sim.ny),nx=xs.length;
    const add=(i,j,bottom,n)=>{data.push(i,j,bottom,...n,...gold);return data.length/9-1;};
    for(const j of ys)for(const i of xs)add(i,j,0,[0,0,1]);
    for(let j=0;j<ys.length-1;j++)for(let i=0;i<nx-1;i++){const a=j*nx+i,b=a+1,c=a+nx,d=c+1;indices.push(a,b,d,a,d,c);}
    const edge=(points,n)=>{for(let k=0;k<points.length-1;k++){const [i,j]=points[k],[ii,jj]=points[k+1],a=add(i,j,0,n),b=add(ii,jj,0,n),c=add(ii,jj,1,n),d=add(i,j,1,n);indices.push(a,b,c,a,c,d);}};
    edge(xs.map(i=>[i,0]),[0,-1,0]);edge(xs.map(i=>[i,sim.ny-1]),[0,1,0]);edge(ys.map(j=>[0,j]),[-1,0,0]);edge(ys.map(j=>[sim.nx-1,j]),[1,0,0]);
    this.mesh=this.uploadMesh(new Float32Array(data),new Uint32Array(indices));this.meshKey=key;this.textureRevision=-1;
  }
  drawMesh(){const gl=this.gl;this.attributes(this.mesh.buffer);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.mesh.index);gl.drawElements(gl.TRIANGLES,this.mesh.count,gl.UNSIGNED_INT,0);}
  renderMill(sim){
    if(!this.begin(sim))return false;
    const gl=this.gl,u=this.uniforms,b=sim.stockBounds();this.millMesh(sim);
    if(this.textureRevision!==sim.materialRevision){gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,sim.nx,sim.ny,0,gl.RED,gl.FLOAT,sim.depth);this.textureRevision=sim.materialRevision;}
    gl.uniformMatrix4fv(u.uProjection,false,orthographic(sim));gl.uniform3f(u.uOrigin,b.minX,b.minY,b.maxZ);gl.uniform2f(u.uSize,sim.cfg.x,sim.cfg.y);gl.uniform1f(u.uHeight,sim.cfg.z);gl.uniform1i(u.uMode,0);gl.uniform1f(u.uLit,1);
    if(sim.showStock)this.drawMesh();
    this.drawCutter(sim);sim.ctx.drawImage(this.canvas,0,0,sim.w,sim.h);return true;
  }
  drawCutter(sim){
    const gl=this.gl,tool=sim.currentTool,segments=sim.displayQualitySettings().toolSegments,key=[tool.type,tool.diameter,tool.length,tool.angle,tool.flutes,tool.cuttingLength,tool.helixAngle,segments].join(':');
    if(key!==this.toolKey){if(this.toolBuffer)gl.deleteBuffer(this.toolBuffer);this.toolBuffer=gl.createBuffer();const data=buildCutterMesh(tool,segments);this.attributes(this.toolBuffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);this.toolCount=data.length/9;this.toolKey=key;}
    this.attributes(this.toolBuffer);gl.uniform1i(this.uniforms.uMode,1);gl.uniform3f(this.uniforms.uOffset,sim.toolPos.x,sim.toolPos.y,sim.toolPos.z);gl.drawArrays(gl.TRIANGLES,0,this.toolCount);
  }
  latheMesh(sim){
    const {rings,step}=sim.quality(),count=sim.exposedCount(),key=`lathe:${count}:${rings}:${step}`;if(this.meshKey===key)return;
    this.disposeMesh(this.mesh);const data=[],indices=[],gold=[.84,.66,.20],add=(i,a,flag)=>{data.push(i,a,flag,0,0,1,...gold);return data.length/9-1;};
    const samples=[];for(let i=0;i<count-1;i+=step)samples.push(i);samples.push(count-1);
    for(let side=0;side<2;side++){
      const offset=data.length/9;
      for(const i of samples)for(let a=0;a<=rings;a++)add(i,a/rings*TAU,side);
      for(let i=0;i<samples.length-1;i++)for(let a=0;a<rings;a++){const p=offset+i*(rings+1)+a,q=p+1,r=p+rings+1,s=r+1;indices.push(p,q,s,p,s,r);}
    }
    for(let a=0;a<rings;a++){const theta=a/rings*TAU,next=(a+1)/rings*TAU,p=add(0,theta,2),q=add(0,next,2),r=add(0,next,3),s=add(0,theta,3);indices.push(p,q,r,p,r,s);}
    this.mesh=this.uploadMesh(new Float32Array(data),new Uint32Array(indices));this.meshKey=key;
  }
  renderLathe(sim,faces){
    if(!this.begin(sim))return false;
    const gl=this.gl,u=this.uniforms;this.latheMesh(sim);
    const data=new Float32Array(sim.count*2);data.set(sim.profile);data.set(sim.innerProfile,sim.count);gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,sim.count,2,0,gl.RED,gl.FLOAT,data);
    gl.uniformMatrix4fv(u.uProjection,false,perspective(sim));gl.uniform2f(u.uSize,sim.cfg.stickout,0);gl.uniform1i(u.uMode,2);gl.uniform1f(u.uLit,1);this.drawMesh();
    const vertices=[];
    for(const face of faces){
      const pts=face.cameraPoints.map(p=>[p.x,p.y,p.z]),col=SurfaceRenderer.color(face.fill);
      if(!col)continue;
      for(let i=1;i<pts.length-1;i++)triangle(vertices,pts[0],pts[i],pts[i+1],col);
    }
    gl.uniformMatrix4fv(u.uProjection,false,perspective(sim,false));gl.uniform1i(u.uMode,1);gl.uniform1f(u.uLit,0);this.attributes(this.dynamic);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,vertices.length/9);
    sim.ctx.drawImage(this.canvas,0,0,sim.w,sim.h);return true;
  }
  static color(value){
    if(!value)return null;
    if(value[0]==='#'){const hex=value.slice(1),s=hex.length===3?[...hex].map(x=>x+x).join(''):hex;return[0,2,4].map(i=>parseInt(s.slice(i,i+2),16)/255);}
    const rgb=value.match(/[\d.]+/g);return rgb?.length>=3?rgb.slice(0,3).map(v=>Number(v)/255):[.5,.5,.5];
  }
}
