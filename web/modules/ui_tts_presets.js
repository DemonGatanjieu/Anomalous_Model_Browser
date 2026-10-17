import { t } from './interface_settings.js';
import { anomalousAlert, anomalousConfirm, anomalousPrompt } from './ui_dialog.js';
import { button, el } from './usage_view.js';
import {
    BUILTIN, CROSS, LABEL_LENGTH, MAX_CUSTOM, PRESETS_FORMAT, SAMPLING, isBuiltin, languagePairs, loadPresets,
    newPresetId, presetLabel, presetUses, presetsFile, removePreset, savePresets, stateFromView,
} from './tts_presets_api.js';
import { keepParamFocus, renderPresetSwitch } from './ui_tts_preset_switch.js';

/**
 * "Generation presets" in GPT-SoVITS Settings. The presets are a row of choices: the one
 * picked shows its numbers against the one looked at before (ui_tts_preset_switch.js), to be
 * changed in place; under it "Make default", "Reset" for a changed built-in one, "Rename" and
 * "Delete" for one made here, and "+ New" copies the one picked. Then which preset a pair of
 * languages uses (a Japanese character speaking Chinese). Every change is saved at once to
 * the node's presets file; a character's own settings are in ui_tts_tuning.js.
 */

/**
 * The settings group; `status` is the node's status (its `format` tells whether it has presets);
 * `reveal` scrolls to it once its presets are in (the Script Director's link).
 */
export function renderTtsPresets(status, groups, local, { reveal = false } = {}) {
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
    let selected = null;
    let previous = null;

    const names = () => Object.keys(state.numbers);
    const label = name => presetLabel(state.labels, name, t);
    const changed = name => isBuiltin(name) && SAMPLING.some(key => state.numbers[name][key] !== view.builtin[name][key]);
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
        keepParamFocus(body, draw);
        save();
    };
    const pick = (name) => {
        previous = selected;
        selected = name;
        draw();
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

    /** A name for a new or renamed preset, or null; a taken one is refused. */
    const askName = async (message, current = '') => {
        const wanted = String(await anomalousPrompt(message, current, t('ttsPresetsTitle'), { maxLength: LABEL_LENGTH }) || '').trim();
        if (!wanted || wanted === current) return null;
        if (names().some(name => label(name) === wanted)) {
            await anomalousAlert(t('ttsPresetNameTaken', { name: wanted }));
            return null;
        }
        return wanted;
    };

    const addPreset = async () => {
        if (names().length - BUILTIN.length >= MAX_CUSTOM) return anomalousAlert(t('ttsPresetTooMany', { count: MAX_CUSTOM }));
        const wanted = await askName(t('ttsPresetNewName', { from: label(selected), count: LABEL_LENGTH }));
        if (!wanted) return;
        const id = newPresetId(names());
        change(() => {
            state.numbers[id] = { ...state.numbers[selected] };
            state.labels[id] = wanted;
            previous = selected;
            selected = id;
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
        if (!await anomalousConfirm(message, t('ttsPresetsTitle'), { okLabel: t('ttsPresetDelete') })) return;
        change(() => {
            removePreset(state, name);
            previous = null;
            selected = state.defaultName;
        });
    };

    const draw = () => {
        const newChip = button('anomalous-sd-run-choice anomalous-tts-switch-new', t('ttsPresetNew'), addPreset);
        newChip.hidden = !local;
        const modes = renderPresetSwitch({
            choices: names().map(name => ({
                id: name,
                label: label(name),
                badge: name === state.defaultName ? t('ttsPresetDefaultBadge') : (isBuiltin(name) ? '' : t('ttsPresetCustom')),
            })),
            selected,
            previous,
            values: name => state.numbers[name],
            builtin: name => (isBuiltin(name) ? view.builtin[name] : null),
            editable: () => local,
            onPick: pick,
            onEdit: (name, key, value) => change(() => { state.numbers[name][key] = value; }),
            extra: [newChip],
        });

        const about = el('div', 'anomalous-tts-switch-about');
        about.append(el('span', 'anomalous-tts-setup-meta', isBuiltin(selected) ? t(`ttsPresetDesc_${selected}`) : t('ttsPresetDescCustom')));
        if (local) {
            if (selected === state.defaultName) about.append(el('span', 'anomalous-tts-setup-meta', t('ttsPresetIsDefault')));
            else about.append(button('anomalous-tts-link', t('ttsPresetMakeDefault'), () => change(() => { state.defaultName = selected; })));
            if (changed(selected)) {
                about.append(button('anomalous-tts-link', t('ttsPresetResetOne'), () => change(() => { state.numbers[selected] = { ...view.builtin[selected] }; })));
            }
            if (!isBuiltin(selected)) {
                about.append(button('anomalous-tts-link', t('ttsPresetRename'), () => renamePreset(selected)),
                    button('anomalous-tts-link is-danger', t('ttsPresetDelete'), () => deletePreset(selected)));
            }
        }

        const rules = el('div', 'anomalous-tts-preset-rules');
        const row = (text, select) => rules.append(el('span', 'anomalous-tts-setup-meta', text), select);
        for (const pair of languagePairs(groups, view.languages)) {
            const [ref, lang] = pair.split('>');
            row(t('ttsPresetsPair', { ref: t(`scriptRunLang_${ref}`), lang: t(`scriptRunLang_${lang}`) }),
                presetSelect(state.rules[pair] || state.cross, value => change(() => { state.rules[pair] = value; })));
        }
        row(t('ttsPresetsCross'), presetSelect(state.cross, value => change(() => { state.cross = value; })));

        body.replaceChildren(el('div', 'anomalous-tts-setup-meta', t('ttsPresetsModes')), modes, about,
            el('div', 'anomalous-tts-setup-meta', t('ttsPresetsLanguages')), rules);
    };

    loadPresets().then(data => {
        view = data;
        state = stateFromView(data);
        selected = state.defaultName;
        draw();
        if (reveal) group.scrollIntoView({ block: 'start' });
    }).catch(e => {
        body.textContent = t('ttsPresetsSaveFailed', { error: e.message });
    });
    return group;
}
