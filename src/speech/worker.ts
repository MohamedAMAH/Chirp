import {parakeet} from './parakeet';
import {qwen} from './qwen';
import type {SpeechAdapter} from './recognizer';
type Job={init:true;model:string;root:string}|{init:false;id:number;samples:Float32Array};
let adapter:SpeechAdapter;
process.parentPort.on('message',({data}:{data:Job})=>{
  try {
    if(data.init){
      if(data.model!=='qwen' && data.model!=='parakeet')throw Error('Unknown model');
      adapter=(data.model==='qwen'?qwen:parakeet)(data.root);
      process.parentPort.postMessage({ready:true});
    } else {
      process.parentPort.postMessage({id:data.id,text:adapter.transcribe(data.samples,16000)});
    }
  }catch{
    process.parentPort.postMessage(data.init?{failure:'Model unavailable'}:{id:data.id,failure:'Transcription failed'});
  }
});
