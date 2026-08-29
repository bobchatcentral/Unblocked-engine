const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { crawlSite } = require('./crawler');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 640,
    minHeight: 520,
  //broken image code, will add back later
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Let the user pick where to save the final archive file.
ipcMain.handle('choose-save-location', async (event, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Website Archive',
    defaultPath: defaultName || 'site-archive.html',
    filters: [{ name: 'HTML File', extensions: ['html'] }],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

// Run the crawl + capture + inline pipeline, streaming progress back to the UI.
ipcMain.handle('start-crawl', async (event, options) => {
  const sender = event.sender;
  const log = (msg) => {
    if (!sender.isDestroyed()) sender.send('crawl-log', msg);
  };
  try {
    const html = await crawlSite(options, log);
    return { success: true, html };
  } catch (err) {
    log(`ERROR: ${err.message}`);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-file', async (event, { filePath, contents }) => {
  fs.writeFileSync(filePath, contents, 'utf8');
  return true;
});

ipcMain.handle('open-file-location', async (event, filePath) => {
  shell.showItemInFolder(filePath);
});
