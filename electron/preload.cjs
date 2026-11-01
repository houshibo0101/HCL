const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const listen = (channel, callback) => {
  const handler = (_event, data) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('hcl', {
  listen,
  getState: () => invoke('app:get-state'),
  saveSettings: (settings) => invoke('settings:save', settings),
  getVersions: (refresh) => invoke('versions:list', refresh),
  installVersion: (version, name, loader) => invoke('versions:install', version, name, loader),
  searchProjects: (options) => invoke('modrinth:search', options),
  getProjectVersions: (projectId, options) => invoke('modrinth:versions', projectId, options),
  downloadResource: (resource) => invoke('modrinth:download', resource),
  selectInstance: (id) => invoke('instances:select', id),
  deleteInstance: (id) => invoke('instances:delete', id),
  launchInstance: (id) => invoke('game:launch', id),
  openFolder: (kind, id) => invoke('folder:open', kind, id),
  chooseJava: () => invoke('dialog:java'),
  chooseGameDirectory: () => invoke('dialog:directory'),
  detectJava: () => invoke('java:detect'),
  cancelTask: (id) => invoke('tasks:cancel', id),
  clearTasks: () => invoke('tasks:clear'),
  openErrorLog: () => invoke('logs:open-error'),
  checkForUpdates: () => invoke('app:check-updates'),
  installUpdate: () => invoke('app:install-update'),
  onTask: (callback) => listen('tasks:update', callback),
  onInstances: (callback) => listen('instances:update', callback),
  onGameLog: (callback) => listen('game:log', callback),
  windowMinimize: () => invoke('window:minimize'),
  windowMaximize: () => invoke('window:maximize'),
  windowClose: () => invoke('window:close'),
});
