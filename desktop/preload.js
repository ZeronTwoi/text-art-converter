// The one small bridge between the desktop shell and the page: files the shell was
// started with. The page (initPWA in 27-share-pwa.js) turns them back into File
// objects and opens them exactly like a dropped or picked file.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopHost', {
  takeOpenedFiles: () => ipcRenderer.invoke('open-files:take'),                   // files from this start
  onOpenedFiles: cb => ipcRenderer.on('open-files', (e, files) => cb(files)),     // files from a later start
  onUpdateAvailable: cb => ipcRenderer.on('update-available', (e, info) => cb(info)),   // a newer release exists
  openUpdate: () => ipcRenderer.invoke('update:open'),                            // open the download page outside
  version: () => ipcRenderer.invoke('app:version'),
});
