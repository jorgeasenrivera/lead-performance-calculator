/* Puts the Live Activity's button intents into the app target.
   -------------------------------------------------------------------------
   iOS finds App Intents in the metadata compiled from the APP's own sources.
   The intent lives in intents/ (with the QueueAttributes it needs), and this
   copies both into the generated Xcode project's app group at prebuild and adds
   them to the app target. The widget target gets its own copies from
   targets/queue via @bacons/apple-targets. Nothing here is edited by hand:
   `npx expo prebuild --clean` redoes it. */
const { withDangerousMod, withXcodeProject, IOSConfig } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const FILES = ["QueueIntents.swift", "QueueAttributes.swift"];

module.exports = function withQueueIntent(config) {
  config = withDangerousMod(config, ["ios", async (c) => {
    const from = path.join(c.modRequest.projectRoot, "intents");
    const to = path.join(c.modRequest.platformProjectRoot, c.modRequest.projectName);
    for (const f of FILES) fs.copyFileSync(path.join(from, f), path.join(to, f));
    return c;
  }]);
  return withXcodeProject(config, (c) => {
    const project = c.modResults;
    const group = c.modRequest.projectName;
    for (const f of FILES) {
      const filepath = `${group}/${f}`;
      if (!project.hasFile(filepath)) {
        IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath, groupName: group, project });
      }
    }
    return c;
  });
};
