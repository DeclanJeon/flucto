import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./electron-stub-loader-hooks.mjs', pathToFileURL(`${process.cwd()}/tests/`));
