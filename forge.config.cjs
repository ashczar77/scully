module.exports = {
  packagerConfig: {
    asar: true,
    executableName: "scully",
    ignore: (path) =>
      path !== "" &&
      !/^\/(dist|package\.json|LICENSE|THIRD_PARTY_NOTICES\.md)(\/|$)/.test(
        path,
      ),
  },
  makers: [],
};
