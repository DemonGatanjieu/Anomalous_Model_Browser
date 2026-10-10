import { t } from './interface_settings.js';

/**
 * Edit emotions' clip search: finds a character's clips by file name or by their line (the
 * lines come from Anomalous_TTS interface 14; with an older node only names are searched)
 * and lists the first matches to hear, to use as the main voice or to add as an emotion.
 */

const SHOWN = 30;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const node = el('button', className, label);
    node.type = 'button';
    node.onclick = onClick;
    if (title) node.title = title;
    return node;
}

/** `play(path)`, `onMain(path)` and `onEmotion(path)` act on a match. Returns { element, setClips }. */
export function createClipSearch({ play, onMain, onEmotion }) {
    const box = el('div', 'anomalous-tts-search');
    const input = el('input', 'anomalous-tts-search-input');
    input.type = 'search';
    input.placeholder = t('ttsSearchPlaceholder');
    input.disabled = true;
    const results = el('div', 'anomalous-tts-search-results');
    box.append(input, results);
    let clips = [];
    let lines = new Map();

    const row = (path) => {
        const line = el('div', 'anomalous-tts-search-row');
        const copy = el('div', 'anomalous-tts-search-copy');
        copy.title = path;
        copy.append(
            el('span', 'anomalous-tts-search-name', path.split('/').pop()),
            el('span', 'anomalous-tts-search-line', lines.get(path) || t('ttsSearchNoLine')),
        );
        line.append(
            button('anomalous-audio-play-btn', '▶', () => play(path), t('audioPlay')),
            copy,
            button('anomalous-tts-search-use', t('ttsSearchUseMain'), () => onMain(path)),
            button('anomalous-tts-search-use', t('ttsSearchAddEmotion'), () => onEmotion(path)),
        );
        return line;
    };

    const render = () => {
        const words = input.value.trim().toLowerCase().split(' ').filter(Boolean);
        if (!words.length) {
            results.replaceChildren();
            return;
        }
        const found = clips.filter(path => {
            const hay = `${path} ${lines.get(path) || ''}`.toLowerCase();
            return words.every(word => hay.includes(word));
        });
        results.replaceChildren(...found.slice(0, SHOWN).map(row));
        if (!found.length) results.append(el('div', 'anomalous-tts-hint', t('ttsSearchNone')));
        else if (found.length > SHOWN) results.append(el('div', 'anomalous-tts-hint', t('ttsSearchMore', { count: found.length - SHOWN })));
    };
    input.addEventListener('input', render);

    return {
        element: box,
        /** The character's clips and their lines (`null`: the node sends no lines, names only). */
        setClips(list, lineMap) {
            clips = list;
            lines = lineMap || new Map();
            input.placeholder = t(lineMap ? 'ttsSearchPlaceholder' : 'ttsSearchNamesOnly');
            input.disabled = false;
            render();
        },
    };
}
