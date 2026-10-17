import { t } from './interface_settings.js';
import { button, el } from './usage_view.js';
import { PRESET_NAMES, PRESETS_FORMAT, SAMPLING, languagePairs, loadPresets, presetsFile, savePresets } from './tts_presets_api.js';

/**
 * "Generation presets" in GPT-SoVITS Settings: the default preset for every character,
 * which preset a pair of languages uses (a Japanese character speaking Chinese), and,
 * folded, the three presets' numbers. Every change is saved at once to the node's presets
 * file; a character's own settings are in ui_tts_tuning.js.
 */

const RANGES = { top_k: [1, 100, 1], top_p: [0.05, 1, 0.05], temperature: [0.05, 2, 0.05], repetition_penalty: [1, 2, 0.05] };

function presetSelect(value, onChange) {
    const select = el('select', 'anomalous-sd-run-select');
    for (const name of PRESET_NAMES) {
        const option = el('option', '', t(`ttsPreset_${name}`));
        option.value = name;
        select.append(option);
    }
    select.value = value;
    select.onchange = () => onChange(select.value);
    return select;
}

function numberInput(key, value, onChange) {
    const [min, max, step] = RANGES[key];
    const input = el('input', 'anomalous-tts-number');
    Object.assign(input, { type: 'number', min, max, step, value });
    input.onchange = () => {
        const number = key === 'top_k' ? Math.round(Number(input.value)) : Number(input.value);
        if (Number.isFinite(number) && number >= min && number <= max) onChange(number);
        else input.value = value;
    };
    return input;
}

/** The settings group; `status` is the node's status (its `format` tells whether it has presets). */
export function renderTtsPresets(status, groups, local) {
    const group = el('div', 'anomalous-tts-setup-group anomalous-tts-presets');
    group.append(el('div', 'anomalous-tts-section', t('ttsPresetsTitle')));
    if (Number(status?.format) < PRESETS_FORMAT) {
        group.append(el('div', 'anomalous-tts-hint', t('ttsPresetsNeedsNode')));
        return group;
    }
    const body = el('div', 'anomalous-tts-presets-body', '…');
    const note = el('div', 'anomalous-tts-hint', t('ttsPresetsHint'));
    group.append(note, body);
    let view = null;
    let state = null;

    const save = async () => {
        try {
            view = await savePresets(presetsFile(view, state));
            note.textContent = `${t('ttsPresetsHint')} ${t('ttsPresetsSaved')}`;
        } catch (e) {
            note.textContent = t('ttsPresetsSaveFailed', { error: e.message });
        }
    };
    const change = (apply) => {
        apply();
        draw();
        save();
    };

    const draw = () => {
        const tiles = el('div', 'anomalous-tts-preset-tiles');
        for (const name of PRESET_NAMES) {
            const tile = button(`anomalous-tts-preset-tile${state.defaultName === name ? ' is-active' : ''}`, '', () => {
                if (local && state.defaultName !== name) change(() => { state.defaultName = name; });
            });
            tile.append(el('strong', '', t(`ttsPreset_${name}`)), el('span', '', t(`ttsPresetDesc_${name}`)));
            tile.disabled = !local;
            tiles.append(tile);
        }

        const table = el('div', 'anomalous-tts-preset-rules');
        const row = (label, select) => {
            select.disabled = !local;
            table.append(el('span', 'anomalous-tts-setup-meta', label), select);
        };
        for (const pair of languagePairs(groups, view.languages)) {
            const [ref, lang] = pair.split('>');
            row(t('ttsPresetsPair', { ref: t(`scriptRunLang_${ref}`), lang: t(`scriptRunLang_${lang}`) }),
                presetSelect(state.rules[pair] || state.cross, value => change(() => { state.rules[pair] = value; })));
        }
        row(t('ttsPresetsCross'), presetSelect(state.cross, value => change(() => { state.cross = value; })));

        const numbers = el('details', 'anomalous-tts-preset-numbers');
        numbers.append(el('summary', '', t('ttsPresetsNumbers')));
        const grid = el('div', 'anomalous-tts-preset-grid');
        grid.append(el('span', ''), ...SAMPLING.map(key => el('span', 'anomalous-tts-setup-meta', t(`scriptRunParamName_${key}`))));
        for (const name of PRESET_NAMES) {
            grid.append(el('span', '', t(`ttsPreset_${name}`)));
            for (const key of SAMPLING) {
                const input = numberInput(key, state.numbers[name][key], value => change(() => { state.numbers[name][key] = value; }));
                input.disabled = !local;
                grid.append(input);
            }
        }
        const reset = button('anomalous-tts-link', t('ttsPresetsReset'), () => change(() => {
            state.numbers = structuredClone(view.builtin);
        }));
        reset.disabled = !local;
        numbers.append(grid, reset);
        numbers.open = body.querySelector('details')?.open || false;

        body.replaceChildren(el('div', 'anomalous-tts-setup-meta', t('ttsPresetDefault')), tiles,
            el('div', 'anomalous-tts-setup-meta', t('ttsPresetsLanguages')), table, numbers);
    };

    loadPresets().then(data => {
        view = data;
        state = { defaultName: data.default, rules: { ...data.languages }, cross: data.cross, numbers: structuredClone(data.presets) };
        draw();
    }).catch(e => {
        body.textContent = t('ttsPresetsSaveFailed', { error: e.message });
    });
    return group;
}
