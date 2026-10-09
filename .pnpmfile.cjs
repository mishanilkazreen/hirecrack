// typescript-eslint does not support TypeScript 7 yet (it needs the TS 6 JS API), while the project
// compiles with TS 7. Give the typescript-eslint packages their own copy of the TS 6 API under the
// name "typescript". Remove this file once typescript-eslint supports TS >= 7.1.
// https://github.com/typescript-eslint/typescript-eslint/issues/10940
function readPackage(pkg) {
  if (pkg.name === 'typescript-eslint' || pkg.name.startsWith('@typescript-eslint/')) {
    if (pkg.peerDependencies) delete pkg.peerDependencies.typescript;
    if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta.typescript;
    pkg.dependencies = { ...pkg.dependencies, typescript: 'npm:@typescript/typescript6@6.0.2' };
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
