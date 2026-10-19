import { t } from './interface_settings.js';
import { anomalousAlert, anomalousConfirm, anomalousPrompt } from './ui_dialog.js';
import { button, el } from './usage_view.js';
import {
    BUILTIN, CROSS, LABEL_LENGTH, MAX_CUSTOM, PRESETS_FORMAT, SAMPLE_LINES, SAMPLING, isBuiltin, languagePairs, loadPresets,
    newPresetId, presetLabel, presetUses, presetsFile, removePreset, savePresets, stateFromView,
} from './tts_presets_api.js';
import { keepParamFocus, renderPresetSwitch } from './ui_tts_preset_switch.js';
import { createModePreview } from './ui_tts_mode_preview.js';
import { remember, remembered } from './ui_tab_strip.js';

/**
 * The tones (the node's generation presets) in GPT-SoVITS Settings, two tabs' worth. "Which tone
 * to use": a row of choices; the one picked says in a few words what it is, can be heard read by
 * a character next to the others (ui_tts_mode_preview.js), and with "Numbers" switched on is shown
 * against the default one with its numbers, changed in place (ui_tts_preset_switch.js); beside it
 * "Make default", "Reset" for a changed built-in one, "Rename" and "Delete" for one made here, and
 * "+ New" copies the one picked. "Speaking another language": which tone a pair of languages uses
 * (a Japanese character speaking Chinese). Every change is saved at once to the node's presets
 * file; a character's own settings are in ui_tts_tuning.js.
 */

const DETAIL_KEY = 'anomalous_tts_tones_detail';

/**
 * `{ tones, languages }`, the two parts; `status` is the node's status (its `format` tells whether
 * it has presets).
 */
export function renderTtsPresets(status, groups, local) {
    const group = el('div', 'anomalous-tts-setup-group anomalous-tts-presets');
    const languages = el('div', 'anomalous-tts-setup-group');
    if (Number(status?.format) < PRESETS_FORMAT) {
        group.append(el('div', 'anomalous-tts-hint', t('ttsPresetsNeedsNode')));
        languages.append(el('div', 'anomalous-tts-hint', t('ttsPresetsNeedsNode')));
        return { tones: group, languages };
    }
    let detail = remembered(DETAIL_KEY, ['simple', 'numbers'], 'simple') === 'numbers';
    const head = el('div', 'anomalous-tts-presets-head');
    const body = el('div', 'anomalous-tts-presets-body', '…');
    const note = el('div', 'anomalous-tts-hint');
    note.hidden = true;
    group.append(head, body, note);
    let view = null;
    let state = null;
    let selected = null;
    // Listening: a character (the first one by default) and a line in its language, which can be changed.
    let speaker = groups[0] || null;
    let line = null;
    const speakerLine = () => line ?? SAMPLE_LINES[speaker?.raw?.reference?.language || speaker?.language] ?? SAMPLE_LINES.zh;
    const preview = createModePreview(() => draw());

    const names = () => Object.keys(state.numbers);
    const label = name => presetLabel(state.labels, name, t);
    const changed = name => isBuiltin(name) && SAMPLING.some(key => state.numbers[name][key] !== view.builtin[name][key]);
    const save = async () => {
        try {
            view = await savePresets(presetsFile(view, state));
            note.textContent = t('ttsPresetsSaved');
        } catch (e) {
            note.textContent = t('ttsPresetsSaveFailed', { error: e.message });
        }
        note.hidden = false;
    };
    const change = (apply) => {
        apply();
        keepParamFocus(body, draw);
        save();
    };
    const pick = (name) => {
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
            selected = state.defaultName;
        });
    };

    /** Who reads which line, then the listen buttons. */
    const listenRow = (choices) => {
        const box = el('div', 'anomalous-tts-listen-setup');
        const who = el('select', 'anomalous-sd-run-select');
        for (const group of groups) {
            const option = el('option', '', group.character);
            option.value = group.character;
            who.append(option);
        }
        who.value = speaker?.character || '';
        who.onchange = () => {
            speaker = groups.find(group => group.character === who.value) || null;
            line = null;
            draw();
        };
        const text = el('input', 'anomalous-tts-listen-text');
        Object.assign(text, { type: 'text', value: speakerLine(), maxLength: 80 });
        text.onchange = () => { line = text.value.trim(); draw(); };
        const take = name => ({ character: speaker?.character, text: speakerLine(), language: 'auto', mode: name, preset: name, numbers: state.numbers[name] });
        const row = preview.row({
            takeFor: take,
            selected,
            modes: choices,
            onPick: pick,
        });
        box.append(el('span', 'anomalous-tts-setup-meta', t('ttsListenWho')), who, text, row);
        return box;
    };

    const draw = () => {
        const newChip = button('anomalous-sd-run-choice anomalous-tts-switch-new', t('ttsPresetNew'), addPreset);
        newChip.hidden = !local;
        const choices = names().map(name => ({
            id: name,
            label: label(name),
            badge: name === state.defaultName ? t('ttsPresetDefaultBadge') : (isBuiltin(name) ? '' : t('ttsPresetCustom')),
        }));
        // Under the choices: what the picked one is and what can be done with it, then listening.
        const about = el('div', 'anomalous-tts-switch-about');
        about.append(el('span', 'anomalous-tts-switch-what', t('ttsPresetWhat', {
            name: label(selected), about: isBuiltin(selected) ? t(`ttsPresetDesc_${selected}`) : t('ttsPresetDescCustom'),
        })));
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

        const listening = el('div', 'anomalous-tts-switch-listen');
        listening.append(about);
        if (local && groups.length) listening.append(listenRow(choices));
        const modes = renderPresetSwitch({
            choices,
            selected,
            base: state.defaultName,
            baseName: t('ttsFeelYourDefault', { name: label(state.defaultName) }),
            baseText: t('ttsFeelIsDefault'),
            values: name => state.numbers[name],
            describe: name => (isBuiltin(name) ? t(`ttsPresetDesc_${name}`) : t('ttsPresetDescCustom')),
            builtin: name => (isBuiltin(name) ? view.builtin[name] : null),
            editable: () => local,
            onPick: pick,
            onEdit: (name, key, value) => change(() => { state.numbers[name][key] = value; }),
            extra: [newChip],
            listen: listening,
            detail,
        });

        const rules = el('div', 'anomalous-tts-preset-rules');
        const row = (text, select) => rules.append(el('span', 'anomalous-tts-setup-meta', text), select);
        rules.append(el('div', 'anomalous-tts-hint anomalous-tts-preset-rules-hint', t('ttsPresetsLanguages')));
        for (const pair of languagePairs(groups, view.languages)) {
            const [ref, lang] = pair.split('>');
            row(t('ttsPresetsPair', { ref: t(`scriptRunLang_${ref}`), lang: t(`scriptRunLang_${lang}`) }),
                presetSelect(state.rules[pair] || state.cross, value => change(() => { state.rules[pair] = value; })));
        }
        row(t('ttsPresetsCross'), presetSelect(state.cross, value => change(() => { state.cross = value; })));

        // "Simple / Numbers" beside the title: the comparison and the numbers only when asked for.
        const title = el('div', 'anomalous-tts-section', t('ttsPresetsPick'));
        title.title = t('ttsPresetsHint');
        const toggle = el('div', 'anomalous-sd-run-segment');
        toggle.setAttribute('role', 'radiogroup');
        for (const [id, key] of [['simple', 'ttsTonesSimple'], ['numbers', 'ttsTonesNumbers']]) {
            const chip = button('anomalous-sd-run-choice', t(key), () => {
                if ((id === 'numbers') === detail) return;
                detail = id === 'numbers';
                remember(DETAIL_KEY, id);
                draw();
            });
            chip.setAttribute('role', 'radio');
            chip.setAttribute('aria-checked', String((id === 'numbers') === detail));
            toggle.append(chip);
        }
        head.replaceChildren(title, toggle);
        body.replaceChildren(modes);
        languages.replaceChildren(rules);
    };

    loadPresets().then(data => {
        view = data;
        state = stateFromView(data);
        selected = state.defaultName;
        draw();
    }).catch(e => {
        body.textContent = t('ttsPresetsSaveFailed', { error: e.message });
    });
    return { tones: group, languages };
}
