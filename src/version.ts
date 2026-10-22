import { createRequire } from 'node:module';

type PackageMetadata = {
    version?: unknown;
};

// The compiled files live in dist/, one level below package.json.
const require = createRequire(import.meta.url);
const metadata = require('../package.json') as PackageMetadata;

if (typeof metadata.version !== 'string' || metadata.version.trim().length === 0) {
    throw new Error('VERTEX package.json is missing a valid version.');
}

export const APP_VERSION = metadata.version;
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
