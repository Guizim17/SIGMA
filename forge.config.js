const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    icon: "assets/icon",
    extraResource: ["data/medicamentos.db"],
    ignore: [
      /^\/out\//,
      // "data" já vai via extraResource acima; "pdf_bulas" não é usado pelo app (fontes das bulas).
      /^\/data\//,
      /^\/pdf_bulas\//,
      // Ferramental de build do Electron Forge (devDependencies) que a poda
      // automática do packager não está removendo corretamente. O padrão
      // "(\/|$)" precisa bater com a própria pasta do escopo (sem barra no
      // final) para impedir que o packager desça até o pacote e caia na
      // lógica de poda (que ignora esta lista de "ignore").
      /^\/node_modules\/@electron(\/|$)/,
      /^\/node_modules\/@electron-forge(\/|$)/,
      /^\/node_modules\/@electron-internal(\/|$)/,
      /^\/node_modules\/@gar(\/|$)/,
      /^\/node_modules\/@inquirer(\/|$)/,
      /^\/node_modules\/@isaacs(\/|$)/,
      /^\/node_modules\/@jridgewell(\/|$)/,
      /^\/node_modules\/@listr2(\/|$)/,
      /^\/node_modules\/@malept(\/|$)/,
      /^\/node_modules\/@nodelib(\/|$)/,
      /^\/node_modules\/@npmcli(\/|$)/,
      /^\/node_modules\/@sindresorhus(\/|$)/,
      /^\/node_modules\/@szmarczak(\/|$)/,
      /^\/node_modules\/@tootallnate(\/|$)/,
      /^\/node_modules\/@types(\/|$)/,
      /^\/node_modules\/@vscode(\/|$)/,
      /^\/node_modules\/@webassemblyjs(\/|$)/,
      /^\/node_modules\/@xmldom(\/|$)/,
      /^\/node_modules\/@xtuc(\/|$)/,
      /^\/node_modules\/\.package-lock\.json$/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'SIGMA',
        setupIcon: 'assets/icon.ico',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
