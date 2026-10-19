/**
 * The workflow (or API prompt) a ComfyUI PNG carries, read in the browser from its text
 * chunks (tEXt, uncompressed iTXt) before the image data: the gallery's detail falls back to
 * it when the server could not say. Null for anything that is not such a PNG. No DOM.
 */

export async function parsePngMetadataFromUrl(url, options = {}) {
    if (!url) return null;
    try {
        const response = await fetch(url, { cache: 'force-cache', signal: options.signal });
        if (!response.ok) return null;
        const buffer = await response.arrayBuffer();
        const view = new DataView(buffer);
        if (view.byteLength < 32) return null;
        // PNG magic bytes: 137, 80, 78, 71, 13, 10, 26, 10
        if (view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) return null;

        let offset = 8;
        const utf8 = new TextDecoder('utf-8');
        const latin1 = new TextDecoder('iso-8859-1');
        const result = {};

        while (offset + 8 <= buffer.byteLength) {
            const length = view.getUint32(offset);
            const type = String.fromCharCode(
                view.getUint8(offset + 4),
                view.getUint8(offset + 5),
                view.getUint8(offset + 6),
                view.getUint8(offset + 7),
            );
            const dataOffset = offset + 8;
            if (type === 'IDAT') break; // Reached image raster data, text metadata is prior

            if (dataOffset + length > buffer.byteLength) break;

            if (type === 'tEXt') {
                const bytes = new Uint8Array(buffer, dataOffset, length);
                const nullIdx = bytes.indexOf(0);
                if (nullIdx > -1) {
                    const key = latin1.decode(bytes.subarray(0, nullIdx));
                    const val = latin1.decode(bytes.subarray(nullIdx + 1));
                    try { result[key] = JSON.parse(val); } catch { result[key] = val; }
                }
            } else if (type === 'iTXt') {
                const bytes = new Uint8Array(buffer, dataOffset, length);
                const nullIdx = bytes.indexOf(0);
                if (nullIdx > -1) {
                    const key = latin1.decode(bytes.subarray(0, nullIdx));
                    let ptr = nullIdx + 1;
                    const compFlag = bytes[ptr++];
                    const compMethod = bytes[ptr++];
                    while (ptr < bytes.length && bytes[ptr] !== 0) ptr++;
                    ptr++;
                    while (ptr < bytes.length && bytes[ptr] !== 0) ptr++;
                    ptr++;
                    if (compFlag === 0 && ptr <= bytes.length) {
                        const val = utf8.decode(bytes.subarray(ptr));
                        try { result[key] = JSON.parse(val); } catch { result[key] = val; }
                    }
                }
            }
            offset += 12 + length;
        }
        return result.workflow || result.prompt || null;
    } catch (e) {
        if (e?.name === 'AbortError') return null;
        console.warn('Client-side PNG metadata read skipped:', e);
        return null;
    }
}
