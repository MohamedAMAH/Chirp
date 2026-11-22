import {ipcRenderer} from 'electron';
window.addEventListener('DOMContentLoaded',()=>{
  const output=document.querySelector('output')!;
  ipcRenderer.on('indicator',(_event,text:string)=>{output.textContent=text;});
});
