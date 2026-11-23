// Inspect only this disposable, locally launched copy of the packaged application.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {createInterface}=require('node:readline');
const path=require('node:path');
const fs=require('node:fs/promises');
const root=path.resolve(__dirname,'..');
async function run(){
  const profile=await fs.mkdtemp(path.join(root,'build/packaged-test-'));
  const binary=process.argv[2]||path.join(root,'dist/win-unpacked/Chirp.exe');
  const child=spawn(binary,['--inspect=127.0.0.1:0','--user-data-dir='+profile],
    {stdio:['ignore','ignore','pipe'],windowsHide:true});
  const exited=once(child,'exit');
  let socket;
  const limit=setTimeout(()=>child.kill(),65000);
  try {
    const url=await new Promise((resolve,reject)=>{
      const lines=createInterface({input:child.stderr});
      lines.on('line',line=>{
        const match=line.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[\w-]+)/);
        if(match)resolve(match[1]);
      });
      child.once('exit',()=>reject(Error('Packaged app exited before the test connected.')));
    });
    socket=new WebSocket(url);
    await once(socket,'open');
    const result=new Promise((resolve,reject)=>{
      socket.addEventListener('message',event=>{
        const msg=JSON.parse(event.data);
        if(msg.id===1)resolve(msg);
      });
      child.once('exit',()=>reject(Error('Packaged app exited during recognition.')));
    });
    const expression=`(async()=>{
      const load=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/out/main/index.js');
      const {app,utilityProcess,globalShortcut}=load('electron');
      await app.whenReady();
      const results=[];
      for(const model of ['qwen','parakeet']){
        const w=utilityProcess.fork(process.resourcesPath+'/app.asar/out/speech/worker.js');
        const next=()=>new Promise((res,rej)=>{w.once('message',res);w.once('exit',()=>rej(Error('Worker exited.')));});
        let message=next(); w.postMessage({init:true,model,root:process.resourcesPath+'/models'});
        if(!(await message).ready)throw Error('Model could not load: '+model);
        message=next();w.postMessage({id:1,samples:new Float32Array(16000)});
        const reply=await message;
        if(reply.id!==1||reply.text!=='')throw Error('Silence check failed: '+model);
        w.kill(); results.push(model);
      }
      return {models:results,shortcut:globalShortcut.isRegistered('Control+Q')};
    })()`;
    socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
    const reply=await result;
    assert.ok(!reply.result?.exceptionDetails,JSON.stringify(reply.result?.exceptionDetails));
    assert.deepEqual(reply.result.result.value,{models:['qwen','parakeet'],shortcut:true});
    console.log('Packaged Qwen, Parakeet, silence handling and global quit registration passed.');
    socket.send(JSON.stringify({id:2,method:'Runtime.evaluate',params:{expression:"process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/out/main/index.js')('electron').app.quit()"}}));
    socket.close(); await exited;
  } finally {clearTimeout(limit);socket?.close();if(child.exitCode===null)child.kill();}
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
