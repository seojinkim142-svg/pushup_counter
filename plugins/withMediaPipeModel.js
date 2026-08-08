const { withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MODEL_FILENAME = 'pose_landmarker_lite.task';

/**
 * react-native-mediapipe resolves its `model` param via Android's
 * AssetManager (BaseOptions.setModelAssetPath), so the .task file must live
 * in android/app/src/main/assets — Metro's JS asset bundling (used for the
 * old .tflite model) doesn't reach that folder, so this has to be copied in
 * as a prebuild step every time the native project is regenerated.
 */
const withMediaPipeModelAndroid = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const src = path.join(config.modRequest.projectRoot, 'assets', 'models', MODEL_FILENAME);
      const destDir = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'assets');
      const dest = path.join(destDir, MODEL_FILENAME);
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(src, dest);
      return config;
    },
  ]);
};

/**
 * On iOS, react-native-mediapipe resolves its `model` param via
 * `Bundle.main.path(forResource:ofType:)`, so the .task file has to be a
 * Copy Bundle Resources entry in the Xcode project — just placing the file
 * under ios/ isn't enough, Xcode only bundles files it has a project
 * reference for. Both the copy and the project-file edit have to happen on
 * every prebuild since expo prebuild regenerates ios/ from scratch.
 */
const withMediaPipeModelIos = (config) => {
  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const src = path.join(config.modRequest.projectRoot, 'assets', 'models', MODEL_FILENAME);
      const dest = path.join(config.modRequest.platformProjectRoot, MODEL_FILENAME);
      fs.copyFileSync(src, dest);
      return config;
    },
  ]);

  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    project.addResourceFile(MODEL_FILENAME, {
      target: project.getFirstTarget().uuid,
    });
    return config;
  });
};

const withMediaPipeModel = (config) => {
  config = withMediaPipeModelAndroid(config);
  config = withMediaPipeModelIos(config);
  return config;
};

module.exports = withMediaPipeModel;
