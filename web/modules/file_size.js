/** A file's size in words people read: KB, MB or GB. No imports, so any module can use it. */
export function formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
    if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(value / 1024))} KB`;
}
