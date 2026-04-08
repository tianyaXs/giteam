const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');

const projectRoot = __dirname;
const nodeModules = path.resolve(projectRoot, 'node_modules');
const workspaceNodeModules = path.resolve(projectRoot, '../../node_modules');

const config = getDefaultConfig(projectRoot);

// In workspace mode, Metro may resolve React from parent node_modules,
// which can bundle multiple React copies and crash at runtime on web.
config.resolver.disableHierarchicalLookup = false;
config.resolver.nodeModulesPaths = [nodeModules, workspaceNodeModules];
config.resolver.extraNodeModules = {
  react: path.resolve(nodeModules, 'react'),
  'react-dom': path.resolve(nodeModules, 'react-dom'),
  'react-native': path.resolve(nodeModules, 'react-native')
};
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName === 'react/jsx-runtime' || moduleName === 'react/jsx-dev-runtime') {
    return context.resolveRequest(context, path.resolve(nodeModules, moduleName), platform);
  }
  if (moduleName === 'react-dom' || moduleName === 'react-dom/client') {
    return context.resolveRequest(context, path.resolve(nodeModules, moduleName), platform);
  }
  if (moduleName === 'react-native') {
    return context.resolveRequest(context, path.resolve(nodeModules, 'react-native'), platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};
config.resolver.blockList = exclusionList([
  /.*\/node_modules\/[^/]+\/node_modules\/react\/.*/,
  /.*\/node_modules\/[^/]+\/node_modules\/react-dom\/.*/,
  /.*\/node_modules\/[^/]+\/node_modules\/react-native\/.*/
]);

module.exports = config;
