const { app, BrowserWindow } = require("electron");
const path = require("path");

// Importa e inicia a API
require("./api.js");

function criarJanela() {
  const janela = new BrowserWindow({
    width: 1100,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Carrega o front-end
  janela.loadURL("http://localhost:5000/index.html");
}

// Quando o Electron estiver pronto, cria a janela
app.whenReady().then(criarJanela);

// Fecha o app quando todas as janelas forem fechadas
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});