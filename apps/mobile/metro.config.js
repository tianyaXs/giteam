const path = require('path');
const fs = require('fs');
const { getDefaultConfig } = require('expo/metro-config');
const exclusionList = require('metro-config/private/defaults/exclusionList').default;
const { getBundleModeMetroConfig } = require('react-native-worklets/bundleMode');

const projectRoot = __dirname;
const localNodeModules = path.resolve(projectRoot, 'node_modules');
const rootNodeModules = path.resolve(projectRoot, '../../node_modules');
const nodeModules = fs.existsSync(localNodeModules) ? localNodeModules : rootNodeModules;
const resolvePackageRoot = (pkg) => path.dirname(require.resolve(`${pkg}/package.json`, {
  paths: [projectRoot, localNodeModules, rootNodeModules]
}));
const reactRoot = resolvePackageRoot('react');
const reactDomRoot = resolvePackageRoot('react-dom');
const reactNativeRoot = resolvePackageRoot('react-native');
const workletsPackageJson = require.resolve('react-native-worklets/package.json', {
  paths: [projectRoot, nodeModules, rootNodeModules]
});
const workletsRoot = path.dirname(workletsPackageJson);

let config = getDefaultConfig(projectRoot);

config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [nodeModules, rootNodeModules].filter((value, index, list) => list.indexOf(value) === index);
config.resolver.extraNodeModules = {
  react: reactRoot,
  'react-dom': reactDomRoot,
  'react-native': reactNativeRoot
};
config.watchFolders = config.watchFolders || [];
const workletsOutput = path.resolve(workletsRoot, '.worklets');
if (fs.existsSync(workletsOutput) && !config.watchFolders.includes(workletsOutput)) {
  config.watchFolders.push(workletsOutput);
}

const defaultResolver = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName === 'react/jsx-runtime' || moduleName === 'react/jsx-dev-runtime') {
    return context.resolveRequest(context, path.resolve(reactRoot, moduleName.replace(/^react/, '.')), platform);
  }
  if (moduleName === 'react-dom' || moduleName === 'react-dom/client') {
    return context.resolveRequest(context, path.resolve(reactDomRoot, moduleName.replace(/^react-dom/, '.')), platform);
  }
  if (moduleName === 'react-native') {
    return context.resolveRequest(context, reactNativeRoot, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

config.resolver.resolveRequest = defaultResolver;
config = getBundleModeMetroConfig(config);
const bundleModeResolver = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('react-native-worklets/.worklets/')) {
    return bundleModeResolver(context, moduleName, platform);
  }
  return defaultResolver(context, moduleName, platform);
};
config.resolver.blockList = exclusionList([
  /.*\/node_modules\/[^/]+\/node_modules\/react\/.*/,
  /.*\/node_modules\/[^/]+\/node_modules\/react-dom\/.*/,
  /.*\/node_modules\/[^/]+\/node_modules\/react-native\/.*/
]);

module.exports = config;
