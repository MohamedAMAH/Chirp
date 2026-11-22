import {app,globalShortcut} from 'electron';
import {Shell} from './shell';
let shell:Shell;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.whenReady().then(async()=>{
    shell=new Shell();
    await shell.load();
    shell.status('Ready');
  });
  app.on('window-all-closed',()=>{});
  app.on('will-quit',()=>globalShortcut.unregisterAll());
}
