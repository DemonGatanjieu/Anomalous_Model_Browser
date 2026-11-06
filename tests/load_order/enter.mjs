// Imports the module at argv[2] first, as ComfyUI may, and prints OK or what its evaluation threw.
import { pathToFileURL } from 'node:url';

process.on('unhandledRejection', () => {}); // a promise a stand-in left hanging is not the module's top level
try {
    await import(pathToFileURL(process.argv[2]).href);
    console.log('OK');
} catch (error) {
    console.log('ERR ' + String(error?.message || error).split('\n')[0]);
}
process.exit(0);
