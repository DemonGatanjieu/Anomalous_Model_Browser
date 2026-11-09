/**
 * ui_model_guide.js
 * The model details' facts under the head, one list of rows, each a name and what it is, parted by thin lines
 * (a profile's, not boxes): Civitai's trigger words, else the words the LoRA's own file suggests (a guess, marked
 * as one), the settings its author's example pictures used, for a model loaded in parts the text encoder and VAE
 * it needs with the file of that name found here, then rows the details page gives (its versions on Civitai,
 * the file's name). Words copy on a click, all of them with Copy. All but Civitai's words come from GET
 * /anomalous/model_guide (api/model_guide.py), asked once per details page and put in before the page's rows;
 * a newer page cancels the request, and a page left before it answers is not filled.
 */
import { translate } from './locales.js';

const t = (key, params) => translate(key, params);
let asking = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function copyButton(words) {
    const button = el('button', 'anomalous-guide-copy', t('detailCopy'));
    button.type = 'button';
    button.onclick = () => navigator.clipboard.writeText(words.join(', ')).then(() => {
        button.textContent = t('detailCopied');
        setTimeout(() => { button.textContent = t('detailCopy'); }, 1500);
    });
    return button;
}

/** One row: its name, and what it is. */
function row(label, ...content) {
    const value = el('div', 'anomalous-guide-value');
    value.append(...content.filter(Boolean));
    return [el('div', 'anomalous-guide-label', label), value];
}

function wordsRow(label, words, hint = '') {
    const list = el('span', 'anomalous-guide-words');
    for (const word of words) {
        const chip = el('span', hint ? 'anomalous-guide-word is-guess' : 'anomalous-guide-word', word);
        chip.title = t('clickToCopy') + word;
        chip.onclick = () => navigator.clipboard.writeText(word).then(() => {
            chip.classList.add('is-copied');
            setTimeout(() => chip.classList.remove('is-copied'), 500);
        });
        list.appendChild(chip);
    }
    return row(label, list, copyButton(words), hint && el('div', 'anomalous-guide-hint', hint));
}

/** "Euler a", or "Euler a (2/3)" when not every picture used it. */
function most(value, pictures) {
    return value[1] < pictures ? `${value[0]} (${value[1]}/${pictures})` : String(value[0]);
}

function settingsRow(examples) {
    const { pictures } = examples;
    const items = [
        examples.sampler && most(examples.sampler, pictures),
        examples.scheduler && most(examples.scheduler, pictures),
        examples.steps && t('guideSteps', { steps: examples.steps }),
        examples.cfg && `CFG ${examples.cfg}`,
        examples.size && most(examples.size, pictures),
        examples.clip_skip && `Clip skip ${examples.clip_skip}`,
        examples.lora_weight && t('guideLoraWeight', { weight: examples.lora_weight }),
    ].filter(Boolean);
    return row(t('detailRowExamples'), el('span', 'anomalous-guide-settings', items.join(' · ')),
        el('span', 'anomalous-guide-note', t('guideExamplesCount', { count: pictures })));
}

function partRows(parts) {
    return parts.flatMap((part) => {
        const state = el('span', part.found ? 'anomalous-guide-part-state' : 'anomalous-guide-part-state is-missing',
            part.found ? `✓ ${t('guidePartFound', { file: part.found })}` : t('guidePartMissing'));
        return row(t(`guidePart_${part.folder}`), el('code', 'anomalous-guide-part-file', part.file), state);
    });
}

/**
 * The list for `model` (a listed model: type, path_idx, subfolder, filename, metadata); `more` the details page's
 * own rows after it: `versions` (its Civitai versions box) and `file` (the file's name, when it is not the name).
 */
export function createModelGuide(model, more = {}) {
    const box = el('div', 'anomalous-guide');
    const trained = (model.metadata?.trainedWords || []).filter(word => String(word).trim());
    if (trained.length) box.append(...wordsRow(t('detailRowWords'), trained));
    const tail = [
        ...(more.versions ? row(t('detailRowVersions'), more.versions) : []),
        ...(more.file ? row(t('detailRowFile'), el('span', 'anomalous-guide-file', more.file)) : []),
    ];
    box.append(...tail);
    const add = nodes => (tail.length ? tail[0].before(...nodes) : box.append(...nodes));
    asking?.abort();
    asking = null;
    if (!model.type || !model.filename) return box;
    const request = new AbortController();
    asking = request;
    const query = new URLSearchParams({
        type: model.type, path_idx: String(model.path_idx ?? 0), subfolder: model.subfolder || '', filename: model.filename,
    });
    fetch(`/anomalous/model_guide?${query}`, { signal: request.signal })
        .then(response => (response.ok ? response.json() : null))
        .then(guide => {
            if (!guide || request.signal.aborted || !box.isConnected) return;
            if (!trained.length && guide.words?.length) add(wordsRow(t('detailRowHeaderWords'), guide.words, t('guideHeaderWordsHelp')));
            if (guide.examples?.pictures) add(settingsRow(guide.examples));
            if (guide.parts?.length) add(partRows(guide.parts));
        })
        .catch(error => {
            if (error.name !== 'AbortError') console.warn('[Anomalous] model guide:', error);
        });
    return box;
}
