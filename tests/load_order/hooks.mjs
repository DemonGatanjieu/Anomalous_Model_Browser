// ComfyUI's own scripts (../../../scripts/app.js and the like) resolve to the stand-in of page.mjs.
const STAND = 'data:text/javascript,' + encodeURIComponent(
    'const s = globalThis.__loadOrderStand; export const app = s; export const api = s; export const ComfyApp = s; export const $el = s; export default s;');

export async function resolve(specifier, context, next) {
    if (/(^|\/)scripts\/[^/]+\.js$/.test(specifier) && specifier.startsWith('.')) return { url: STAND, shortCircuit: true };
    return next(specifier, context);
}
