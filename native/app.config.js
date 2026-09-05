/* app.json is the config. This adds the one thing that cannot sit in it: the
   Android push file, which only exists on an Android build (the workflow writes
   it from a secret) and which the config parser refuses to reference when it is
   absent, which it always is on an iOS build. */
const fs = require("fs");
const path = require("path");

module.exports = ({ config }) => {
  const gs = path.join(__dirname, "google-services.json");
  if (fs.existsSync(gs)) {
    config.android = { ...(config.android || {}), googleServicesFile: "./google-services.json" };
  }
  /* The widget target (targets/queue) is signed against the Apple team, which
     the build already knows as EXPO_APPLE_TEAM_ID. Read it from there rather
     than writing the team into a file. */
  if (process.env.EXPO_APPLE_TEAM_ID) {
    config.ios = { ...(config.ios || {}), appleTeamId: process.env.EXPO_APPLE_TEAM_ID };
  }
  return config;
};
