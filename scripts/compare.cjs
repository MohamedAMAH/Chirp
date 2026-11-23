const path=require('node:path');
const {spawnSync}=require('node:child_process');
const sherpa=require('sherpa-onnx-node');
const root=path.join(__dirname,'../models');
const files=process.argv.slice(2);
if(!files.length) files.push(...['noise1-en.wav','de.wav','ar1.wav'].map(f=>path.join(root,'qwen/test_wavs',f)));
const selected=process.env.CHIRP_COMPARE_CHILD;
if(!selected){
  for(const name of ['qwen','parakeet']){
    const result=spawnSync(process.execPath,[__filename,...files],{
      env:{...process.env,CHIRP_COMPARE_CHILD:name},stdio:'inherit'});
    if(result.status!==0)process.exit(result.status??1);
  }
}else{
  if(!['qwen','parakeet'].includes(selected))throw Error('Invalid model');
  const adapter=require('../out/speech/'+selected)[selected](root);
  const first=sherpa.readWave(files[0]);
  adapter.transcribe(first.samples,first.sampleRate);
  for(const file of files){
    const {samples,sampleRate}=sherpa.readWave(file);
    const start=performance.now();
    const text=adapter.transcribe(samples,sampleRate);
    console.log(JSON.stringify({model:selected,file:path.basename(file),seconds:samples.length/sampleRate,
      decodeMs:Math.round(performance.now()-start),text}));
  }
}
