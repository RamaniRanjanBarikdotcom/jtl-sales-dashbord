export type BuildInfo = {
  version: string;
  buildSha: string;
  buildTime: string;
};

export function getBuildInfo(): BuildInfo {
  return {
    version: process.env.APP_VERSION || '1.0.0',
    buildSha: process.env.BUILD_SHA || 'development',
    buildTime: process.env.BUILD_TIME || 'unknown',
  };
}
