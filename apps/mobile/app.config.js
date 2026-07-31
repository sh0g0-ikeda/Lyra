const omitNativeReleaseSettings = (value, keys) => {
  if (value === undefined) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key))
  );
};

const hasPlugin = (plugins, name) => plugins.some((plugin) =>
  plugin === name || (Array.isArray(plugin) && plugin[0] === name)
);

module.exports = ({ config }) => {
  const ios = omitNativeReleaseSettings(config.ios, [
    'associatedDomains',
    'bundleIdentifier'
  ]);
  const android = omitNativeReleaseSettings(config.android, [
    'googleServicesFile',
    'intentFilters',
    'package'
  ]);
  const plugins = Array.isArray(config.plugins) ? config.plugins : [];
  const withImage = hasPlugin(plugins, 'expo-image')
    ? plugins
    : [...plugins, 'expo-image'];
  const withImagePicker = hasPlugin(withImage, 'expo-image-picker')
    ? withImage
    : [
        ...withImage,
        [
          'expo-image-picker',
          {
            cameraPermission: false,
            microphonePermission: false,
            photosPermission: 'Lyraがキャラ参照画像として選んだ写真を読み取ることを許可してください。'
          }
        ]
      ];

  return {
    ...config,
    plugins: withImagePicker,
    ...(ios === undefined ? {} : { ios }),
    ...(android === undefined ? {} : { android })
  };
};
