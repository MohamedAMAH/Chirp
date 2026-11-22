import fs from 'node:fs/promises';
import {createReadStream, createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname,'..');
const catalog = [
  ['parakeet','sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8','1495e91b59d7fc53ddca91f3431758ec99f8fa253fdb0e1e851be0f72b14b0f9'],
  ['qwen','sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25','393f8a14e2f5fb96746aaab342997a40641001fbd5bf9592a080a8329178ee96'],
];
async function hash(file) {
  const h=createHash('sha256');
  for await(const chunk of createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}
await fs.mkdir(path.join(root,'models'),{recursive:true});
await fs.mkdir(path.join(root,'build/downloads'),{recursive:true});
for (const [name,bundle,digest] of catalog) {
  const archive=path.join(root,'build/downloads',bundle+'.tar.bz2');
  const stage=await fs.mkdtemp(path.join(root,'build/downloads/setup-'));
  try {
    if (await hash(archive).catch(()=>null)!==digest) {
      console.log('Downloading '+name);
      const tmp=path.join(stage,'archive');
      const response=await fetch('https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/'+bundle+'.tar.bz2');
      if (!response.ok) throw Error('Model download returned '+response.status);
      await pipeline(response.body,createWriteStream(tmp));
      if(await hash(tmp)!==digest) throw Error('Checksum mismatch for '+name);
      await fs.rename(tmp,archive);
    }
    execFileSync('tar.exe',['-xf',archive,'-C',stage],{stdio:'inherit'});
    await fs.cp(path.join(stage,bundle),path.join(root,'models',name),{recursive:true});
    console.log('Verified '+name);
  } finally {await fs.rm(stage,{recursive:true,force:true});}
}
