/* The Live Activity: the salesperson's place in the line on the lock screen
   and in the Dynamic Island. A widget extension is the only kind of target
   that can draw one, so this is a widget target with no home-screen widget in
   it. The Swift beside this file is the whole of it. */
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: "widget",
  name: "SageQueue",
  displayName: "Sage",
  // com.sageonline.queue: its own App ID and provisioning profile, see README.
  bundleIdentifier: ".queue",
  // ActivityKit content state needs 16.2; push-to-start needs 17.2 and is
  // checked at runtime.
  deploymentTarget: "16.2",
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit", "AppIntents"],
  colors: {
    $accent: "#E4C98D",
    $widgetBackground: "#15211B",
  },
};
