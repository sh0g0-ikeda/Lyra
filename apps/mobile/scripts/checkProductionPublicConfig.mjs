import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findProductionPublicEnvironmentMismatches } = require('../productionPublicConfigContract.js');

const mismatchedVariables = findProductionPublicEnvironmentMismatches(process.env);

if (mismatchedVariables.length > 0) {
  console.error(`FAIL ${mismatchedVariables.join(',')}`);
  process.exitCode = 1;
} else {
  console.log('PASS production public environment contract');
}
