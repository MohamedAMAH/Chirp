import {app,globalShortcut} from 'electron';
import {Shell} from './shell';
import {startDictation} from './dictation';
let shell:Shell;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(async()=>{
    shell=new Shell();
    await shell.load();
    startDictation(shell);
  });
  app.on('window-all-closed',()=>{});
  app.on('will-quit',()=>globalShortcut.unregisterAll());
}
