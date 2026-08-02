const { app, BrowserWindow } = require("electron");
const path = require("path");

// Aponta para a pasta onde fica o medicamentos.db
process.env.APP_ROOT = app.isPackaged
  ? process.resourcesPath
  : path.join(__dirname, "..", "data");

// Importa a API depois de definir APP_ROOT
require("./api.js");

function criarJanela() {
  const janela = new BrowserWindow({
    width: 1100,
    height: 700,
    icon: path.join(__dirname, "..", "assets", "icon.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  janela.loadURL("http://localhost:5000/index.html");
}

app.whenReady().then(criarJanela);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});