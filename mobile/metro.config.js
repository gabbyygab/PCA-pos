// Metro only watches the project folder by default, so `shared/` — which sits
// one level up beside web/ — is invisible to it and imports fail at bundle
// time even though TypeScript resolves them. Both the watch folder and the
// alias have to be spelled out, mirroring what next.config.ts does for the
// dashboard's bundler.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('node:path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [path.resolve(workspaceRoot, 'shared')]

// node_modules lives only in mobile/, so resolution walks there first and then
// up — the shared folder ships no dependencies of its own.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

config.resolver.extraNodeModules = {
  '@shared': path.resolve(workspaceRoot, 'shared'),
}

module.exports = config
