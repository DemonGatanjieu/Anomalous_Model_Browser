import { t } from './interface_settings.js';
import { anomalousAlert, anomalousConfirm, anomalousPrompt } from './ui_dialog.js';
import { button, el } from './usage_view.js';
import {
    BUILTIN, CROSS, LABEL_LENGTH, MAX_CUSTOM, PRESETS_FORMAT, SAMPLING, isBuiltin, languagePairs, loadPresets,
    newPresetId, presetLabel, presetUses, presetsDiffer, presetsFile, removePreset, savePresets,
} from './tts_presets_api.js';

/**
 * "Generation presets" in GPT-SoVITS Settings: the default preset for every character, which
 * preset a pair of languages uses (a Japanese character speaking Chinese), and every preset's
 * numbers side by side the way the compare window shows values: numbers that differ between
 * presets marked, shared ones grey, changed built-in numbers with their built-in value. The
 * built-in presets can be changed and reset; new ones are made from a copy, renamed, deleted.
 * Every change is saved at once to the node's presets file; a character's own settings are in
 * ui_tts_tuning.js.
 */

const RANGES = { top_k: [1, 100, 1], top_p: [0.05, 1, 0.05], temperature: [0.05, 2, 0.05], repetition_penalty: [1, 2, 0.05] };

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
    let showSame = true;

    const names = () => Object.keys(state.numbers);
    const label = name => presetLabel(state.labels, name, t);
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

    const presetSelect = (value, onChange) => {
        const select = el('select', 'anomalous-sd-run-select');
        for (const name of names()) {
            const option = el('option', '', label(name));
            option.value = name;
            select.append(option);
        }
        select.value = value;
        select.disabled = !local;
        select.onchange = () => onChange(select.value);
        return select;
    };

    /** A name for a new or renamed preset, or null; asks again while it is taken. */
    const askName = async (message, current = '') => {
        const wanted = String(await anomalousPrompt(message, current, t('ttsPresetsTitle'), { maxLength: LABEL_LENGTH }) || '').trim();
        if (!wanted || wanted === current) return null;
        if (names().some(name => label(name) === wanted)) {
            await anomalousAlert(t('ttsPresetNameTaken', { name: wanted }));
            return null;
        }
        return wanted;
    };

    const addPreset = async (from) => {
        if (names().length - BUILTIN.length >= MAX_CUSTOM) return anomalousAlert(t('ttsPresetTooMany', { count: MAX_CUSTOM }));
        const wanted = await askName(t('ttsPresetNewName', { from: label(from), count: LABEL_LENGTH }));
        if (!wanted) return;
        change(() => {
            const id = newPresetId(names());
            state.numbers[id] = { ...state.numbers[from] };
            state.labels[id] = wanted;
        });
    };

    const renamePreset = async (name) => {
        const wanted = await askName(t('ttsPresetRenameAsk', { name: label(name) }), label(name));
        if (wanted) change(() => { state.labels[name] = wanted; });
    };

    const deletePreset = async (name) => {
        const uses = presetUses(state, name, groups);
        const where = [
            ...uses.general.map(use => (use === 'default' ? t('ttsPresetUseDefault')
                : use === CROSS ? t('ttsPresetsCross')
                    : t('ttsPresetsPair', { ref: t(`scriptRunLang_${use.split('>')[0]}`), lang: t(`scriptRunLang_${use.split('>')[1]}`) }))),
            ...uses.characters,
        ];
        const message = t('ttsPresetDeleteAsk', { name: label(name) }) + (where.length ? `\n${t('ttsPresetDeleteUses', { list: where.join('、') })}` : '');
        if (await anomalousConfirm(message, t('ttsPresetsTitle'), { okLabel: t('ttsPresetDelete') })) change(() => removePreset(state, name));
    };

    /** Every preset's numbers side by side, one column per preset. */
    const numbersTable = () => {
        const all = names();
        const table = el('div', 'anomalous-tts-preset-table');
        table.style.gridTemplateColumns = `auto repeat(${all.length}, minmax(68px, 1fr))`;
        table.append(el('span', ''));
        for (const name of all) {
            const head = el('span', 'anomalous-tts-preset-head');
            head.append(el('strong', '', label(name)), el('span', 'anomalous-tts-preset-kind', t(isBuiltin(name) ? 'ttsPresetBuiltin' : 'ttsPresetCustom')));
            table.append(head);
        }
        for (const key of SAMPLING) {
            const differs = presetsDiffer(state.numbers, key);
            if (!differs && !showSame) continue;
            table.append(el('span', `anomalous-tts-setup-meta${differs ? '' : ' is-same'}`, t(`scriptRunParamName_${key}`)));
            for (const name of all) {
                const value = state.numbers[name][key];
                const builtin = isBuiltin(name) ? view.builtin[name][key] : value;
                const cell = el('span', `anomalous-tts-preset-cell${differs ? ' is-diff' : ' is-same'}${value !== builtin ? ' is-edited' : ''}`);
                const input = numberInput(key, value, number => change(() => { state.numbers[name][key] = number; }));
                input.dataset.cell = `${name}:${key}`;
                input.disabled = !local;
                cell.append(input);
                if (value !== builtin) cell.append(el('span', 'anomalous-tts-preset-was', t('ttsPresetWas', { value: builtin })));
                table.append(cell);
            }
        }
        if (local) {
            table.append(el('span', ''));
            for (const name of all) {
                const actions = el('span', 'anomalous-tts-preset-actions');
                if (!isBuiltin(name)) {
                    actions.append(button('anomalous-tts-link', t('ttsPresetRename'), () => renamePreset(name)),
                        button('anomalous-tts-link is-danger', t('ttsPresetDelete'), () => deletePreset(name)));
                } else if (SAMPLING.some(key => state.numbers[name][key] !== view.builtin[name][key])) {
                    actions.append(button('anomalous-tts-link', t('ttsPresetResetOne'), () => change(() => { state.numbers[name] = { ...view.builtin[name] }; })));
                }
                table.append(actions);
            }
        }
        return table;
    };

    const draw = () => {
        const focused = document.activeElement?.dataset?.cell;
        const tiles = el('div', 'anomalous-tts-preset-tiles');
        for (const name of names()) {
            const tile = button(`anomalous-tts-preset-tile${state.defaultName === name ? ' is-active' : ''}`, '', () => {
                if (local && state.defaultName !== name) change(() => { state.defaultName = name; });
            });
            tile.append(el('strong', '', label(name)), el('span', '', t(isBuiltin(name) ? `ttsPresetDesc_${name}` : 'ttsPresetDescCustom')));
            tile.disabled = !local;
            tiles.append(tile);
        }

        const rules = el('div', 'anomalous-tts-preset-rules');
        const row = (text, select) => rules.append(el('span', 'anomalous-tts-setup-meta', text), select);
        for (const pair of languagePairs(groups, view.languages)) {
            const [ref, lang] = pair.split('>');
            row(t('ttsPresetsPair', { ref: t(`scriptRunLang_${ref}`), lang: t(`scriptRunLang_${lang}`) }),
                presetSelect(state.rules[pair] || state.cross, value => change(() => { state.rules[pair] = value; })));
        }
        row(t('ttsPresetsCross'), presetSelect(state.cross, value => change(() => { state.cross = value; })));

        const numbersHead = el('div', 'anomalous-tts-preset-numbers-head');
        const sameBox = el('label', 'anomalous-tts-preset-same');
        const box = el('input');
        box.type = 'checkbox';
        box.checked = showSame;
        box.onchange = () => { showSame = box.checked; draw(); };
        sameBox.append(box, document.createTextNode(t('ttsPresetsShowSame')));
        numbersHead.append(el('span', 'anomalous-tts-setup-meta', t('ttsPresetsNumbers')), sameBox);

        const tools = el('div', 'anomalous-tts-preset-tools');
        if (local) {
            const from = presetSelect(state.defaultName, () => {});
            tools.append(el('span', 'anomalous-tts-setup-meta', t('ttsPresetNewFrom')), from,
                button('anomalous-tts-link', t('ttsPresetNew'), () => addPreset(from.value)));
            if (BUILTIN.some(name => SAMPLING.some(key => state.numbers[name][key] !== view.builtin[name][key]))) {
                tools.append(button('anomalous-tts-link', t('ttsPresetsReset'), () => change(() => {
                    for (const name of BUILTIN) state.numbers[name] = { ...view.builtin[name] };
                })));
            }
        }

        const scroll = el('div', 'anomalous-tts-preset-scroll');
        scroll.append(numbersTable());
        body.replaceChildren(el('div', 'anomalous-tts-setup-meta', t('ttsPresetDefault')), tiles,
            el('div', 'anomalous-tts-setup-meta', t('ttsPresetsLanguages')), rules, numbersHead, scroll, tools,
            el('div', 'anomalous-tts-hint', t('ttsPresetsLegend')));
        if (focused) body.querySelector(`[data-cell="${focused}"]`)?.focus();
    };

    loadPresets().then(data => {
        view = data;
        state = { defaultName: data.default, rules: { ...data.languages }, cross: data.cross, numbers: structuredClone(data.presets), labels: { ...data.labels } };
        draw();
    }).catch(e => {
        body.textContent = t('ttsPresetsSaveFailed', { error: e.message });
    });
    return group;
}
