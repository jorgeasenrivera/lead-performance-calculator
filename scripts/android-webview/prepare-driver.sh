# Sourced before any KVM grant; the supervised probe inherits this exact cache.
export PLAYWRIGHT_BROWSERS_PATH="${RUNNER_TEMP:?}/sage-playwright-cache"
export ANDROID_PLAYWRIGHT="$RUNNER_TEMP/android-driver/node_modules/playwright/index.mjs"
timeout 300 npm install --prefix "$RUNNER_TEMP/android-driver" --no-package-lock --no-save --ignore-scripts playwright@1.63.0
# Use this installation's CLI, never npx/global resolution or a different version.
timeout 300 node "$RUNNER_TEMP/android-driver/node_modules/playwright/cli.js" install android
timeout 30 python3 scripts/android-webview/verify-driver.py "$RUNNER_TEMP/android-driver" "$PLAYWRIGHT_BROWSERS_PATH" > "$OUT/driver-assets.json"
