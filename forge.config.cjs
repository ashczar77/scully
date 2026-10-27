module.exports = {
  packagerConfig: {
    asar: { unpack: "**/*.node", unpackDir: "node_modules/node-pty" },
    executableName: "scully",
    icon: "assets/branding/scully",
    electronZipDir: process.env.SCULLY_ELECTRON_ZIP_DIR || undefined,
    ignore: (path) =>
      path !== "" &&
      (/^\/node_modules\/node-pty\/prebuilds(\/|$)/.test(path) ||
        (!/^\/(dist|package\.json|LICENSE|THIRD_PARTY_NOTICES\.md)(\/|$)/.test(
          path,
        ) &&
          path !== "/node_modules" &&
          !/^\/node_modules\/(node-pty|node-addon-api|pdfjs-dist|@napi-rs)(\/|$)/.test(
            path,
          ))),
  },
  makers: [],
};
