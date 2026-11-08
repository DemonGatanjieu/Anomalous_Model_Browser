/**
 * ui_model_guide.js
 * The model details' words and settings above the description: Civitai's trigger words, else the
 * words the LoRA's own file suggests (a guess, marked as one), the settings its author's example
 * pictures used, and for a model loaded in parts the text encoder and VAE it needs with the file of
 * that name found here. All but Civitai's words come from GET /anomalous/model_guide
 * (api/model_guide.py), asked once per details page; a newer page cancels the request, and a page
 * left before it answers is not filled.
 */
import { translate } from './locales.js';

const t = (key, params) => translate(key, params);
let asking = null;

function copyButton(words) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'anomalous-guide-copy';
    button.textContent = t('copyAll');
    button.onclick = () => navigator.clipboard.writeText(words.join(', ')).then(() => {
        button.textContent = t('copied');
        setTimeout(() => { button.textContent = t('copyAll'); }, 1500);
    });
    return button;
}

function section(title, ...extra) {
    const box = document.createElement('div');
    box.className = 'anomalous-guide-section';
    const head = document.createElement('div');
    head.className = 'anomalous-guide-head';
    const label = document.createElement('strong');
    label.textContent = title;
    head.append(label, ...extra);
    box.appendChild(head);
    return box;
}

function wordsSection(title, words, hint = '') {
    const box = section(title, copyButton(words));
    if (hint) {
        const line = document.createElement('div');
        line.className = 'anomalous-guide-hint';
        line.textContent = hint;
        box.appendChild(line);
    }
    const list = document.createElement('div');
    list.className = 'anomalous-guide-words';
    for (const word of words) {
        const chip = document.createElement('span');
        chip.className = hint ? 'anomalous-guide-word is-guess' : 'anomalous-guide-word';
        chip.textContent = word;
        chip.title = t('clickToCopy') + word;
        chip.onclick = () => navigator.clipboard.writeText(word).then(() => {
            chip.classList.add('is-copied');
            setTimeout(() => chip.classList.remove('is-copied'), 500);
        });
        list.appendChild(chip);
    }
    box.appendChild(list);
    return box;
}

/** "Euler a", or "Euler a (2/3)" when not every picture used it. */
function most(value, pictures) {
    return value[1] < pictures ? `${value[0]} (${value[1]}/${pictures})` : String(value[0]);
}

function settingsSection(examples) {
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
    const box = section(t('guideExamples', { count: pictures }));
    const list = document.createElement('div');
    list.className = 'anomalous-guide-settings';
    for (const item of items) {
        const pill = document.createElement('span');
        pill.className = 'anomalous-guide-setting';
        pill.textContent = item;
        list.appendChild(pill);
    }
    box.appendChild(list);
    return box;
}

function partsSection(parts) {
    const box = section(t('guideParts'));
    for (const part of parts) {
        const row = document.createElement('div');
        row.className = part.found ? 'anomalous-guide-part' : 'anomalous-guide-part is-missing';
        const role = document.createElement('span');
        role.className = 'anomalous-guide-part-role';
        role.textContent = t(`guidePart_${part.folder}`);
        const name = document.createElement('code');
        name.textContent = part.file;
        const state = document.createElement('span');
        state.className = 'anomalous-guide-part-state';
        state.textContent = part.found ? `✓ ${t('guidePartFound', { file: part.found })}` : t('guidePartMissing');
        row.append(role, name, state);
        box.appendChild(row);
    }
    return box;
}

/** The section for `model` (a listed model: type, path_idx, subfolder, filename, metadata). */
export function createModelGuide(model) {
    const box = document.createElement('div');
    box.className = 'anomalous-guide';
    const trained = (model.metadata?.trainedWords || []).filter(word => String(word).trim());
    if (trained.length) box.appendChild(wordsSection(t('detailTrainedWords'), trained));
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
            if (!trained.length && guide.words?.length) box.appendChild(wordsSection(t('guideHeaderWords'), guide.words, t('guideHeaderWordsHelp')));
            if (guide.examples?.pictures) box.appendChild(settingsSection(guide.examples));
            if (guide.parts?.length) box.appendChild(partsSection(guide.parts));
        })
        .catch(error => {
            if (error.name !== 'AbortError') console.warn('[Anomalous] model guide:', error);
        });
    return box;
}
