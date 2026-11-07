const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('desktop', {
  info: call('app:info'),
  firstRunDone: call('app:first-run-done'),
  openExternal: call('app:open-external'),
  packs: {
    list: call('packs:list'),
    map: call('packs:map'),
    aliases: call('packs:aliases'),
    download: call('packs:download'),
    cancel: call('packs:cancel'),
    removeCache: call('packs:remove-cache'),
    addRemote: call('packs:add-remote'),
    removeCustom: call('packs:remove-custom'),
    onProgress: (fn) => ipcRenderer.on('pack-progress', (_e, data) => fn(data)),
  },
  folders: {
    list: call('folders:list'),
    add: call('folders:add'),
    remove: call('folders:remove'),
  },
  projects: {
    list: call('projects:list'),
    read: call('projects:read'),
    write: call('projects:write'),
    rename: call('projects:rename'),
    trash: call('projects:trash'),
    reveal: call('projects:reveal'),
    chooseLibrary: call('projects:choose-library'),
  },
  files: {
    open: call('files:open'),
    saveAs: call('files:save-as'),
    write: call('files:write'),
  },
  ai: {
    config: call('ai:config'),
    setConfig: call('ai:set-config'),
    models: call('ai:models'),
    complete: call('ai:complete'),
    cancel: call('ai:cancel'),
    onLoading: (fn) => ipcRenderer.on('ai-loading', (_e, loading) => fn(loading)),
  },
  onMenu: (fn) => ipcRenderer.on('menu', (_e, action) => fn(action)),
});
