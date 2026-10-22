module.exports = {
  packagerConfig: {
    asar: { unpackDir: "node_modules/node-pty" },
    executableName: "scully",
    icon: "assets/branding/scully",
    ignore: (path) =>
      path !== "" &&
      (/^\/node_modules\/node-pty\/prebuilds(\/|$)/.test(path) ||
        (!/^\/(dist|package\.json|LICENSE|THIRD_PARTY_NOTICES\.md)(\/|$)/.test(
          path,
        ) &&
          path !== "/node_modules" &&
          !/^\/node_modules\/(node-pty|node-addon-api)(\/|$)/.test(path))),
  },
  makers: [],
};
