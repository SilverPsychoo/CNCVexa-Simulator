const VERSION='6.2.2';
const CURRENT_CACHE=`cncvexa-shell-v${VERSION}`;

export async function prepareAppCache(env=globalThis){
  const serviceWorker=env.navigator?.serviceWorker;
  if(!serviceWorker)return true;
  const scope=new URL('./',env.location.href).href;
  const local=['127.0.0.1','localhost','[::1]'].includes(env.location.hostname);
  const clearCaches=async keepCurrent=>{
    if(!env.caches)return;
    const keys=await env.caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith('cncvexa-shell-')&&(!keepCurrent||key!==CURRENT_CACHE)).map(key=>env.caches.delete(key)));
  };
  try{
    if(local){
      const registrations=await serviceWorker.getRegistrations();
      const own=registrations.filter(registration=>registration.scope===scope);
      const controlled=Boolean(serviceWorker.controller)&&own.length>0;
      await Promise.all(own.map(registration=>registration.unregister()));
      await clearCaches(false);
      if(controlled){env.location.reload();return false;}
    }else{
      // Limpiar la versión anterior antes de cargar los módulos evita que
      // un controlador antiguo sirva el intérprete desde otra caché.
      let timeout;
      try{
        await Promise.race([
          serviceWorker.register(new URL(`sw.js?v=${VERSION}`,scope).href,{scope,updateViaCache:'none'}),
          new Promise(resolve=>{timeout=(env.setTimeout||globalThis.setTimeout)(resolve,2500);})
        ]);
      }catch{}finally{(env.clearTimeout||globalThis.clearTimeout)(timeout);}
      if(env.navigator.onLine!==false)await clearCaches(true);
    }
  }catch{}
  return true;
}

if(typeof window!=='undefined'&&await prepareAppCache(window)){
  await import(`./i18n.js?v=${VERSION}`);
  await import(`./app.js?v=${VERSION}`);
}
