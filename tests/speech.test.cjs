const {test}=require('node:test');
const assert=require('node:assert/strict');
const {segments}=require('../out/speech/recognizer');
test('long dictation keeps every sample across quiet boundaries',()=>{
  const rate=16000,audio=new Float32Array(65*rate).fill(.3);
  audio.fill(0,15*rate,16*rate);
  const parts=[...segments(audio,rate)];
  assert.ok(parts[0].length>=15*rate && parts[0].length<=16*rate);
  let total=0;
  for(const part of parts){
    assert.equal(part.byteOffset,total*4);
    assert.ok(part.length<=18*rate);total+=part.length;
  }
  assert.equal(total,audio.length);
});
test('empty and short recordings remain intact',()=>{
  assert.deepEqual([...segments(new Float32Array(),16000)],[]);
  const audio=Float32Array.of(.7,.2,-.5);
  assert.deepEqual([...segments(audio,16000)],[audio]);
});
