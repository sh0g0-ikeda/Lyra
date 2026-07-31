const omitNativeReleaseSettings = (value, keys) => {
  if (value === undefined) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key))
  );
};

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

  return {
    ...config,
    plugins: plugins.includes('expo-image')
      ? plugins
      : [...plugins, 'expo-image'],
    ...(ios === undefined ? {} : { ios }),
    ...(android === undefined ? {} : { android })
  };
};
