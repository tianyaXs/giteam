const appJson = require('./app.json');

/**
 * Default cloud relay URL for mobile "云端" mode.
 * Injected at build time from EXPO_PUBLIC_DEFAULT_CLOUD_BASE_URL (.env / EAS env).
 * Never hardcode production IPs/domains in committed source.
 */
module.exports = () => {
  const defaultCloudBaseUrl = String(
    process.env.EXPO_PUBLIC_DEFAULT_CLOUD_BASE_URL || 'http://127.0.0.1:8787'
  )
    .trim()
    .replace(/\/$/, '');

  return {
    ...appJson.expo,
    extra: {
      ...(appJson.expo.extra || {}),
      defaultCloudBaseUrl
    }
  };
};
