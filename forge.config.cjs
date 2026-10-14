module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "scully",
    icon: "assets/branding/scully",
    ignore: (path) =>
      path !== "" &&
      !/^\/(dist|package\.json|LICENSE|THIRD_PARTY_NOTICES\.md)(\/|$)/.test(
        path,
      ),
  },
  makers: [],
};
