// Generates only a synthetic module inside Expo's disposable Android project.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const native = path.resolve(here, '../..');
const generated = path.join(native, 'android');
const settings = path.join(generated, 'settings.gradle');
const module = path.join(generated, 'journalProbe');
if (!existsSync(settings) || existsSync(module)) throw new Error('Fresh Expo Android project required');
const java = path.join(module, 'src/main/java/com/sageonline/sagelive');
mkdirSync(java, { recursive: true });
for (const name of ['JournalStoreProbe.kt', 'JournalLockService.kt']) copyFileSync(path.join(here, 'android', name), path.join(java, name));
copyFileSync(path.join(native, 'modules/sage-live/android/src/main/java/com/sageonline/sagelive/SageIntentJournalStore.kt'), path.join(java, 'SageIntentJournalStore.kt'));
// AGP supplies the namespace; the source manifest stays unchanged.
writeFileSync(path.join(module, 'src/main/AndroidManifest.xml'), readFileSync(path.join(here, 'android/AndroidManifest.xml'), 'utf8').replace(' package="com.sageonline.journalprobe"', ''));
writeFileSync(path.join(module, 'build.gradle'), `
apply plugin: 'com.android.application'
apply plugin: 'org.jetbrains.kotlin.android'
evaluationDependsOn(':app')
def sourceAndroid = project(':app').extensions.getByName('android')
android {
  namespace 'com.sageonline.journalprobe'
  compileSdk sourceAndroid.compileSdk
  buildToolsVersion sourceAndroid.buildToolsVersion
  defaultConfig {
    applicationId 'com.sageonline.journalprobe'
    minSdk sourceAndroid.defaultConfig.minSdkVersion.apiLevel
    targetSdk sourceAndroid.defaultConfig.targetSdkVersion.apiLevel
    versionCode 1
    versionName '1'
  }
  compileOptions {
    sourceCompatibility JavaVersion.VERSION_17
    targetCompatibility JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = '17' }
}
tasks.register('reportJournalToolchain') {
  doLast {
    println('JOURNAL_COMPILE_SDK=' + android.compileSdk)
    println('JOURNAL_MIN_SDK=' + android.defaultConfig.minSdkVersion.apiLevel)
    println('JOURNAL_TARGET_SDK=' + android.defaultConfig.targetSdkVersion.apiLevel)
    println('JOURNAL_BUILD_TOOLS=' + android.buildToolsVersion)
    println('JOURNAL_GRADLE=' + gradle.gradleVersion)
    println('JOURNAL_AGP=' + com.android.Version.ANDROID_GRADLE_PLUGIN_VERSION)
    println('JOURNAL_KOTLIN=' + org.jetbrains.kotlin.config.KotlinCompilerVersion.VERSION)
    println('JOURNAL_JAVA=' + System.getProperty('java.version'))
  }
}
`);
appendFileSync(settings, '\n// Disposable synthetic storage validation module, no app wiring.\ninclude(":journalProbe")\n');
console.log('Prepared isolated journalProbe module with exact store source');
