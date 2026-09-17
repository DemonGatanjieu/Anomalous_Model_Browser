/** Shared, stateless media helpers used by recipe save and catalog views. */

export function safeThumbnail(value) {
    return typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,/i.test(value)
        ? value
        : null;
}

export function outputImageUrl(image) {
    if (!image || image.type !== 'output' || typeof image.filename !== 'string') return null;
    const query = new URLSearchParams({ filename: image.filename, type: 'output' });
    if (image.subfolder) query.set('subfolder', image.subfolder);
    return `/view?${query.toString()}`;
}

export function recipeAssetUrl(filename, assetId) {
    if (!filename || !assetId) return null;
    return `/anomalous/recipe_asset?filename=${encodeURIComponent(filename)}&asset=${encodeURIComponent(assetId)}`;
}

export function previewIsVideo(url) {
    return /\.(?:mp4|webm)(?:$|\?|&|#)/i.test(url || '');
}

const DEFAULT_RECIPE_COVERS = [
    new URL('../assets/default_cover_1.webp', import.meta.url).href,
    new URL('../assets/default_cover_2.webp', import.meta.url).href,
    new URL('../assets/default_cover_3.webp', import.meta.url).href,
    new URL('../assets/default_cover_4.webp', import.meta.url).href,
    new URL('../assets/default_cover_5.webp', import.meta.url).href,
    new URL('../assets/default_cover_6.webp', import.meta.url).href,
];

function getDefaultRecipeCover(seed = '') {
    if (!seed) return DEFAULT_RECIPE_COVERS[Math.floor(Math.random() * DEFAULT_RECIPE_COVERS.length)];
    let hash = 0;
    const text = String(seed);
    for (let index = 0; index < text.length; index++) {
        hash = (hash << 5) - hash + text.charCodeAt(index);
        hash |= 0;
    }
    return DEFAULT_RECIPE_COVERS[Math.abs(hash) % DEFAULT_RECIPE_COVERS.length];
}

export function appendRecipeCover(parent, url, alt, seed = '') {
    const isPlaceholder = !url;
    const finalUrl = url || getDefaultRecipeCover(seed || alt);
    if (!isPlaceholder && previewIsVideo(finalUrl)) {
        const video = document.createElement('video');
        video.className = 'anomalous-recipe-thumbnail';
        video.src = finalUrl;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.onpointerenter = () => video.play().catch(() => {});
        video.onpointerleave = () => {
            video.pause();
            video.currentTime = 0;
        };
        parent.appendChild(video);
        return;
    }
    const image = document.createElement('img');
    image.className = 'anomalous-recipe-thumbnail' + (isPlaceholder ? ' is-default-placeholder' : '');
    image.src = finalUrl;
    image.alt = alt || '';
    image.loading = 'lazy';
    parent.appendChild(image);
}
