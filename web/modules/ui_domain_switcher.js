/**
 * Which side the browser is on (image or audio): decides the list column and the "!" guide.
 * The rail's pages switch it (`ui_shell_nav.js`).
 */

const STORAGE_KEY = 'anomalous_active_domain';

export function getActiveDomain() {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'audio' ? 'audio' : 'visual';
    } catch (_) {
        return 'visual';
    }
}

export function setActiveDomain(domain) {
    try {
        localStorage.setItem(STORAGE_KEY, domain === 'audio' ? 'audio' : 'visual');
    } catch (_) {
        // Private windows may refuse storage; the switch still applies to this page.
    }
}
