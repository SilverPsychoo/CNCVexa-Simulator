import { readFile } from 'node:fs/promises';
import { accessSync, constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CNCInterpreter } from '../docs/js/interpreter.js';
import { LatheInterpreter } from '../docs/js/lathe-interpreter.js';
import { StockSimulator } from '../docs/js/simulator.js';
import { LatheSimulator } from '../docs/js/lathe-simulator.js';
import { createKernel, processKernelBatch, STEP_FIELDS, STEP_STRIDE, TOOL_CODES } from '../docs/js/simulation-worker.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requiredFiles = [
  'docs/index.html',
  'docs/styles.css',
  'docs/site.webmanifest',
  'docs/sw.js',
  'docs/js/app.js',
  'docs/js/i18n.js',
  'docs/js/interpreter.js',
  'docs/js/lathe-interpreter.js',
  'docs/js/simulator.js',
  'docs/js/lathe-simulator.js',
  'docs/js/simulation-worker.js',
  'docs/js/simulation-worker-client.js'
];

for (const file of requiredFiles) accessSync(path.join(root, file), constants.R_OK);

for (const file of ['docs/js/app.js', 'docs/js/i18n.js', 'docs/js/interpreter.js', 'docs/js/lathe-interpreter.js', 'docs/js/simulator.js', 'docs/js/lathe-simulator.js', 'docs/js/simulation-worker.js', 'docs/js/simulation-worker-client.js', 'docs/sw.js']) {
  execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' });
}

const manifest = JSON.parse(await readFile(path.join(root, 'docs/site.webmanifest'), 'utf8'));
if (manifest.name !== 'CNCVexa Simulator' || manifest.display !== 'standalone') {
  throw new Error('El manifiesto instalable no contiene la identidad esperada.');
}

const html = await readFile(path.join(root, 'docs/index.html'), 'utf8');
const privacy = await readFile(path.join(root, 'docs/privacy.html'), 'utf8');
const i18n = await readFile(path.join(root, 'docs/js/i18n.js'), 'utf8');
for (const removedUi of ['Simulador listo', 'home-capability-strip', '>Ultra<', 'highrevenueformat.com', 'Adsterra', 'home-adsterra-banner', 'data-action="compile"', 'data-action="pause"', 'class="global-statusbar"', 'data-dock="trace"', 'id="tracePane"', 'Variables Macro']) {
  if (`${html}\n${privacy}\n${i18n}`.includes(removedUi)) throw new Error(`Regresó texto o estructura eliminada a la interfaz: ${removedUi}`);
}
for (const hiddenTechnicalCopy of ['multithread', 'background worker', 'web worker', 'optimized']) {
  if (`${html}\n${i18n}`.toLowerCase().includes(hiddenTechnicalCopy)) throw new Error(`Se expuso texto técnico en la interfaz: ${hiddenTechnicalCopy}`);
}
for (const operationalUi of ['data-run-label', 'data-run-icon', 'data-dock="variables">Variables<', '>Ejecutar<', 'class="sim-options"', 'id="codeHighlight"']) {
  if (!html.includes(operationalUi)) throw new Error(`Falta el control operativo: ${operationalUi}`);
}

const appSource = await readFile(path.join(root, 'docs/js/app.js'), 'utf8');
const millSimulatorSource = await readFile(path.join(root, 'docs/js/simulator.js'), 'utf8');
const latheSimulatorSource = await readFile(path.join(root, 'docs/js/lathe-simulator.js'), 'utf8');
const workerSource = await readFile(path.join(root, 'docs/js/simulation-worker.js'), 'utf8');
const workerClientSource = await readFile(path.join(root, 'docs/js/simulation-worker-client.js'), 'utf8');
if (!appSource.includes('performance.now()+9') || !appSource.includes('simulationId') || !appSource.includes('pendingWorkerBatch')) {
  throw new Error('La ejecución continua perdió el presupuesto temporal o la invalidación por generación.');
}
for (const requiredWorkerFeature of ['processKernelBatch', 'budgetMs', 'dirtyLimit', 'Float64Array', 'Uint32Array']) {
  if (!workerSource.includes(requiredWorkerFeature) && !workerClientSource.includes(requiredWorkerFeature)) throw new Error(`Falta la arquitectura Worker: ${requiredWorkerFeature}`);
}
for (const executionGuard of ['sourceRevision', 'compiledRevision', 'isCompilationCurrent()', 'scheduleLiveCompile()', "compileProgram({silent:true,forRun:true})", "activateDock('diagnostics')", 'data-run-icon']) {
  const source = executionGuard === 'data-run-icon' ? html : appSource;
  if (!source.includes(executionGuard)) throw new Error(`Falta la protección del flujo unificado: ${executionGuard}`);
}
if (appSource.includes('sim.setPath([])')) throw new Error('Editar el programa vuelve a borrar la última trayectoria válida.');
if (!appSource.includes('if(!errors){sim.setPath(compiledSteps)')) throw new Error('La trayectoria no se actualiza de forma segura tras recompilar.');
for (const [name, source] of [['fresa', millSimulatorSource], ['torno', latheSimulatorSource]]) {
  if (!source.includes('applyStep(step,redraw=true)') || !source.includes('setPlaybackActive(value=false)') || !source.includes('pinchDistance')) {
    throw new Error(`El simulador de ${name} perdió el modo de reproducción optimizado.`);
  }
}
if (!millSimulatorSource.includes('return this.qualitySettings(this.renderQuality)') || !latheSimulatorSource.includes('}[this.renderQuality]')) {
  throw new Error('Alta/Ultra volvió a reducirse silenciosamente durante la reproducción.');
}

for (const action of ['new', 'program', 'project']) {
  for (const machine of ['mill', 'lathe']) {
    const pattern = new RegExp(`data-home-action="${action}"[^>]+data-home-machine="${machine}"`);
    if (!pattern.test(html)) throw new Error(`Falta la acción ${action}/${machine} en la portada.`);
  }
}

const millProgram = `O1000
G17 G21 G90 G40 G49 G80
T03 M06
G54
M03 S3000
G00 X0 Y0 Z5
G01 Z-2 F100
G01 X20 Y10 F250
G00 Z10
M30`;
const mill = new CNCInterpreter({ offsets: { G54: { x: 0, y: 0, z: 0 } }, tools: {} });
mill.parse(millProgram).compile();
if (mill.diagnostics.some(item => item.type === 'error') || mill.steps.length < 3) {
  throw new Error(`Falló la compilación de fresa: ${JSON.stringify(mill.diagnostics)}`);
}

const latheProgram = `O2000
G18 G21 G90 G40 G95
T0101
G97 S1200 M03
G00 X62 Z2
G01 X60 Z0 F0.2
G01 Z-20
G00 X70 Z5
M30`;
const latheConfig = {
  stock: {
    diameter: 60,
    length: 120,
    stickout: 100,
    safety: { enabled: true, chuckClearance: 2, holderClearance: 4, xLimit: 400, zMin: -370, zMax: 250 }
  },
  offsets: { G54: { x: 0, z: 0 } },
  tools: { 1: { name: 'Buril exterior 80°', type: 'od', noseRadius: 0.8, insertWidth: 6, orientation: 3, offset: 1 } }
};
const lathe = new LatheInterpreter(latheConfig);
lathe.parse(latheProgram).compile();
if (lathe.diagnostics.some(item => item.type === 'error') || lathe.steps.length < 3) {
  throw new Error(`Falló la compilación de torno: ${JSON.stringify(lathe.diagnostics)}`);
}

function setEncodedStep(data,index,{from,to,size,type}) {
  const base=index*STEP_STRIDE;
  data[base+STEP_FIELDS.kind]=1;
  data[base+STEP_FIELDS.cut]=1;
  data[base+STEP_FIELDS.fromX]=from.x;
  data[base+STEP_FIELDS.fromY]=from.y||0;
  data[base+STEP_FIELDS.fromZ]=from.z;
  data[base+STEP_FIELDS.toX]=to.x;
  data[base+STEP_FIELDS.toY]=to.y||0;
  data[base+STEP_FIELDS.toZ]=to.z;
  data[base+STEP_FIELDS.toolSize]=size;
  data[base+STEP_FIELDS.toolType]=TOOL_CODES[type];
  data[base+STEP_FIELDS.toolAngle]=90;
}

function assertArraysEqual(actual,expected,label){
  if(actual.length!==expected.length)throw new Error(`${label}: longitud distinta.`);
  for(let i=0;i<actual.length;i++)if(Math.abs(actual[i]-expected[i])>1e-6)throw new Error(`${label}: diferencia en ${i}: ${actual[i]} != ${expected[i]}`);
}

const millKernelConfig={x:220,y:120,z:30,resolution:1.5,zeroMode:'corner',positionX:0,positionY:0,tableTopZ:-30,pathStep:.38};
const millBaseline=Object.create(StockSimulator.prototype);
millBaseline.renderQuality='high';millBaseline.cfg={x:220,y:120,z:30,resolution:1.5,zeroMode:'corner',position:{x:0,y:0},table:{topZ:-30}};millBaseline.nx=Math.ceil(220/1.5)+1;millBaseline.ny=Math.ceil(120/1.5)+1;millBaseline.depth=new Float32Array(millBaseline.nx*millBaseline.ny);millBaseline.cutMarks=[];millBaseline.hasCuts=false;
const millEncoded=new Float64Array(24*STEP_STRIDE);
for(let i=0;i<24;i++){const from={x:i%2?190:10,y:8+(i%12)*8,z:-2-(i%5)},to={x:i%2?10:190,y:from.y,z:from.z},type=i%6===0?'ball':'flat';setEncodedStep(millEncoded,i,{from,to,size:10,type});millBaseline.cutSegment(from,to,{diameter:10,type,angle:90});}
const millKernel=createKernel({machine:'mill',config:millKernelConfig,stepsBuffer:millEncoded.buffer}),millWorkerResult=new Float32Array(millBaseline.depth.length);
while(millKernel.cursor<23){const result=processKernelBatch(millKernel,{budgetMs:1000,stepLimit:7});for(let i=0;i<result.indices.length;i++)millWorkerResult[result.indices[i]]=result.values[i];}
assertArraysEqual(millWorkerResult,millBaseline.depth,'Remoción de fresa en Worker');

const latheKernelConfig={diameter:60,length:120,resolution:.5},profileCount=Math.ceil(120/.5)+1,latheBaseline=Object.create(LatheSimulator.prototype);
latheBaseline.cfg=latheKernelConfig;latheBaseline.count=profileCount;latheBaseline.profile=new Float32Array(profileCount);latheBaseline.profile.fill(30);latheBaseline.innerProfile=new Float32Array(profileCount);
const latheEncoded=new Float64Array(30*STEP_STRIDE);
for(let i=0;i<30;i++){const from={x:60-(i%8)*.5,z:-(i%40)},to={x:from.x,z:-Math.min(119,(i%40)+15)},type=i%13===0?'boring':'od',size=type==='boring'?.4:.8;setEncodedStep(latheEncoded,i,{from,to,size,type});latheBaseline.cutSegment(from,to,{noseRadius:size,type});}
const latheKernel=createKernel({machine:'lathe',config:latheKernelConfig,stepsBuffer:latheEncoded.buffer}),outerResult=new Float32Array(profileCount),innerResult=new Float32Array(profileCount);outerResult.fill(30);
while(latheKernel.cursor<29){const result=processKernelBatch(latheKernel,{budgetMs:1000,stepLimit:9});for(let i=0;i<result.indices.length;i++)outerResult[result.indices[i]]=result.values[i];for(let i=0;i<result.innerIndices.length;i++)innerResult[result.innerIndices[i]]=result.innerValues[i];}
assertArraysEqual(outerResult,latheBaseline.profile,'Perfil exterior de torno en Worker');
assertArraysEqual(innerResult,latheBaseline.innerProfile,'Perfil interior de torno en Worker');

function cameraHarness(stock,width,height){
  const simulator=Object.create(LatheSimulator.prototype);simulator.cfg={...stock,resolution:stock.resolution||1};simulator.w=width;simulator.h=height;simulator.viewMode='3d';simulator.camera={yaw:-32*Math.PI/180,pitch:18*Math.PI/180,zoom:1,panX:0,panY:0,fov:37*Math.PI/180,near:.1,target:null,position:null,up:{x:0,y:1,z:0},fitDistance:0};simulator.toolPos={x:stock.diameter+20,z:5};simulator.currentTool={type:'od',insertWidth:6};simulator.profile=new Float32Array(Math.ceil(stock.length/simulator.cfg.resolution)+1);simulator.profile.fill(stock.diameter/2);simulator.innerProfile=new Float32Array(simulator.profile.length);simulator.activeToolNumber=1;simulator.turretAngle=Math.PI;simulator.fitView(false);simulator.activeFrame=simulator.updateCameraPose();return simulator;
}
for(const stock of [{diameter:12,length:30,stickout:10,chuckLength:20},{diameter:60,length:120,stickout:100,chuckLength:30},{diameter:160,length:220,stickout:200,chuckLength:60},{diameter:20,length:500,stickout:480,chuckLength:25}])for(const [width,height] of [[1100,620],[390,420]]){
  const simulator=cameraHarness(stock,width,height),projected=simulator.boundsCorners(simulator.sceneBounds3D()).map(point=>simulator.project3D(point));
  for(const point of projected)if(point.x<12||point.x>width-12||point.y<12||point.y>height-12||point.depth<=simulator.camera.near)throw new Error(`fitView no encuadró Ø${stock.diameter}×${stock.length} en ${width}×${height}.`);
}
const perspective=cameraHarness({diameter:60,length:120,stickout:100,chuckLength:30},1000,600),nearPoint=perspective.project3D({x:0,y:0,z:30}),farPoint=perspective.project3D({x:0,y:0,z:-30});
if(Math.abs(nearPoint.scale-farPoint.scale)<.02)throw new Error('La cámara de torno volvió a una proyección ortográfica.');

console.log(`CNCVexa smoke test OK — fresa: ${mill.steps.length} pasos; torno: ${lathe.steps.length} pasos.`);
