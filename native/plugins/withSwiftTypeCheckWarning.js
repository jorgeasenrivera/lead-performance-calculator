/* Asks Swift to name a slow expression before it gives up on one.
   -------------------------------------------------------------------------
   Builds 18 and 19 failed on Apple's machines with "unable to type-check this
   expression in reasonable time", twenty minutes after the merge, with the
   line named only in a log behind a signed link. The compiler can say which
   expressions are getting slow long before it gives up: this flag has it warn
   about any expression that takes longer than the threshold, in milliseconds,
   so a build log names the line while it is still a warning.

   Applied to every target's Swift: the app and the Live Activity, which is
   where both failures were. The Live Activity's target is made by
   @bacons/apple-targets in its own pass over the Xcode project, after Expo's
   own, so this rides that pass rather than Expo's or it would never see the
   widget. */
const { withXcodeProjectBeta } = require("@bacons/apple-targets/build/with-bacons-xcode");

const FLAG = "-Xfrontend -warn-long-expression-type-checking=150";

module.exports = function withSwiftTypeCheckWarning(config) {
  return withXcodeProjectBeta(config, (c) => {
    const project = c.modResults;
    for (const target of project.rootObject.props.targets) {
      const list = target.props.buildConfigurationList;
      if (!list || !list.props || !list.props.buildConfigurations) continue;
      for (const cfg of list.props.buildConfigurations) {
        const bs = cfg.props.buildSettings;
        if (!bs) continue;
        const have = bs.OTHER_SWIFT_FLAGS == null ? "$(inherited)" : String(bs.OTHER_SWIFT_FLAGS).replace(/^"|"$/g, "");
        if (have.includes("warn-long-expression-type-checking")) continue;
        bs.OTHER_SWIFT_FLAGS = `${have} ${FLAG}`;
      }
    }
    return c;
  });
};
