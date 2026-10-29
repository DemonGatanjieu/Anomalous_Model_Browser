// A PNG's workflow read in the browser (web/modules/png_metadata.js): the download stops at the image data.
import assert from 'node:assert/strict';
import { parsePngMetadataFromUrl } from '../web/modules/png_metadata.js';

function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    return out; // the CRC is not checked
}

const workflow = { nodes: [{ id: 1, type: 'KSampler' }] };
const text = new TextEncoder().encode(`workflow\0${JSON.stringify(workflow)}`);
const pixels = new Uint8Array(4 * 1024 * 1024); // stands for hundreds of megabytes of picture
const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', new Uint8Array(13)), chunk('tEXt', text), chunk('IDAT', pixels), chunk('IEND', new Uint8Array(0))];
const file = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
parts.reduce((at, part) => { file.set(part, at); return at + part.length; }, 0);

let pulled = 0;
globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) {
        if (pulled >= file.length) return controller.close();
        controller.enqueue(file.subarray(pulled, pulled + 7)); // small pieces: chunk headers split across reads
        pulled += 7;
    },
}));
assert.deepEqual(await parsePngMetadataFromUrl('/view?filename=a.png&type=output'), workflow);
assert.ok(pulled < 1024, `read ${pulled} bytes: it stops at the image data`);
console.log('png_metadata: ok');
