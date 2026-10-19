import { t } from './interface_settings.js';
import { button, el } from './usage_view.js';
import { isBuiltin, presetLabel } from './tts_presets_api.js';
import { AUTO_MODE, hasOwnTune, lineNumbers, ownTune, sharedValue } from './script_tune.js';
import { speakerColor } from './ui_script_cast.js';
import { renderPresetSwitch } from './ui_tts_preset_switch.js';

/**
 * The Script Director's side panel, which follows what is picked on the left: nothing, the whole
 * script (each character and how it reads); a character in the cast, how it reads in this script
 * (every line of it follows); picked lines, who reads them and how, each value following the
 * character until it is set here (then the card shows a tag and ↺ lets it follow again).
 * ui_script_run.js keeps the state and draws this again after each change (`ctx`, see
 * renderTunePanel); the lines are the director's.
 */

export const LANGUAGES = ['auto', 'zh', 'ja', 'en'];
const FOLLOW = '__follow'; // a line's mode choice: its character's

/** "1.2×" */
export const speedText = speed => `${Math.round(Number(speed) * 100) / 100}×`;

/** A mode's name: Auto, a built-in preset or one made in Anomalous. */
export function modeName(view, id) {
    return id === AUTO_MODE || !view ? t('scriptRunModeAuto') : presetLabel(view.labels, id, t);
}

/** "中文 · 1.2× · 有起伏": a set of values in a few words (`skip`: leave out the auto language). */
export function valuesText(view, values, { skip = false } = {}) {
    const parts = [];
    if (!(skip && values.language === 'auto')) parts.push(t(`scriptRunLang_${values.language || 'auto'}`));
    if (typeof values.speed === 'number') parts.push(speedText(values.speed));
    parts.push(modeName(view, values.preset ?? AUTO_MODE));
    return parts.join(' · ');
}

/** What a line set for itself, for the tag on its card; '' when it follows its character. */
export function ownTuneText(view, line) {
    if (!hasOwnTune(line)) return '';
    const own = ownTune(line);
    const parts = [];
    if (own.language !== undefined) parts.push(t(`scriptRunLang_${own.language}`));
    if (own.speed !== undefined) parts.push(speedText(own.speed));
    if (own.preset !== undefined) parts.push(modeName(view, own.preset));
    return parts.join(' · ');
}

function heading(title, meta, back) {
    const head = el('div', 'anomalous-sd-tune-head');
    if (back) head.append(button('anomalous-sd-link-btn anomalous-sd-tune-back', t('scriptTuneBack'), back));
    head.append(el('div', 'anomalous-sd-tune-title', title));
    if (meta) head.append(el('div', 'anomalous-sd-tune-meta', meta));
    return head;
}

function row(label, ...content) {
    const line = el('div', 'anomalous-sd-run-row');
    line.append(el('span', 'anomalous-sd-run-label', label), ...content);
    return line;
}

/** Choices in a segment; `checked(id)`; a click on the checked one does nothing. */
function segment(choices, checked, onPick, disabled) {
    const box = el('div', 'anomalous-sd-run-segment');
    box.setAttribute('role', 'radiogroup');
    for (const choice of choices) {
        const chip = button(`anomalous-sd-run-choice${choice.className ? ` ${choice.className}` : ''}`, choice.label, () => {
            if (!checked(choice.id)) onPick(choice.id);
        });
        chip.setAttribute('role', 'radio');
        chip.setAttribute('aria-checked', String(checked(choice.id)));
        chip.disabled = disabled;
        if (choice.title) chip.title = choice.title;
        box.append(chip);
    }
    return box;
}

/** The speed slider: `value`, `onChange(number)`; `after`: elements after the number. */
function speedSlider(ctx, value, onChange, after = []) {
    const range = ctx.spec.speed;
    const slider = el('input', 'anomalous-sd-run-slider');
    Object.assign(slider, { type: 'range', min: String(range.min), max: String(range.max), step: String(range.step ?? 1) });
    slider.value = String(value ?? range.default);
    slider.title = t('scriptRunParamHint_speed');
    slider.disabled = ctx.busy;
    const shown = el('span', 'anomalous-sd-run-value', String(value ?? range.default));
    slider.oninput = () => { shown.textContent = slider.value; };
    slider.onchange = () => {
        const number = Math.min(range.max, Math.max(range.min, Number(slider.value)));
        onChange(Number.isFinite(number) ? number : range.default);
    };
    return row(t('scriptRunSpeed'), slider, shown, ...after);
}

/**
 * The mode switch with its listen row; `line`: the line heard (null: a sample), read by `speaker` with
 * `values` (null: the line's own); `choices` and `base` as renderPresetSwitch.
 */
function modeBox(ctx, { speaker, line, values = null, selected, choices, base, baseName, baseText, describe, numbers, onPick }) {
    const box = el('div', 'anomalous-sd-run-mode');
    if (!ctx.view) return box;
    const view = ctx.view;
    const words = String(line?.text || '').trim();
    const take = id => ctx.takeFor(line, id === FOLLOW ? ctx.options(speaker).preset : id, speaker, values);
    const index = ctx.script.lines.indexOf(line);
    const lead = el('span', 'anomalous-sd-run-listen-line', !words ? t('scriptRunListenSample', { text: take(selected).text })
        : t('scriptRunListenLineAs', { n: index + 1, text: words, who: speaker.character }));
    lead.title = t('scriptRunListenLineHint');
    const switcher = renderPresetSwitch({
        choices,
        selected,
        base,
        baseName,
        baseText,
        values: numbers,
        describe,
        builtin: id => (isBuiltin(id) ? view.builtin[id] : null),
        editable: id => id !== AUTO_MODE && id !== FOLLOW && ctx.local,
        onPick,
        onEdit: ctx.editPreset,
        listen: ctx.preview.row({ takeFor: take, selected, modes: choices, onPick, disabled: ctx.busy, lead: [lead] }),
        disabled: ctx.busy,
        compact: !ctx.roomy,
    });
    const note = el('div', 'anomalous-sd-run-note', ctx.presetNote);
    note.hidden = !ctx.presetNote;
    box.append(el('span', 'anomalous-sd-run-label', t('scriptRunMode')), switcher, note);
    return box;
}

const presetChoices = view => [{ id: AUTO_MODE, label: t('scriptRunModeAuto') },
    ...Object.keys(view?.presets || {}).map(name => ({ id: name, label: presetLabel(view.labels, name, t), badge: isBuiltin(name) ? '' : t('ttsPresetCustom') }))];

const presetAbout = id => (isBuiltin(id) ? t(`ttsPresetDesc_${id}`) : t('ttsPresetDescCustom'));

function links(ctx, speaker) {
    const box = el('div', 'anomalous-sd-run-links');
    box.append(button('anomalous-sd-link-btn', t('scriptRunOpenPresets'), ctx.openPresets));
    if (speaker) box.append(button('anomalous-sd-link-btn', t('scriptRunOpenTuning', { name: speaker.character }), () => ctx.openTuning(speaker)));
    return box;
}

/** Each character reading in this script, a click opens it. */
function renderScriptView(ctx) {
    const { script } = ctx;
    const spoken = script.lines.filter(line => line.text.trim());
    const cast = script.groups.filter(group => spoken.some(line => script.speakerOf(line) === group));
    const parts = [heading(t('scriptTuneScript'), t('scriptTuneScriptMeta', { count: spoken.length, speakers: cast.length }))];
    const list = el('div', 'anomalous-sd-tune-cast');
    for (const group of cast) {
        const lines = spoken.filter(line => script.speakerOf(line) === group);
        const own = lines.filter(hasOwnTune).length;
        const item = button('anomalous-sd-tune-person', '', () => script.focusCharacter(group.group));
        item.style.setProperty('--speaker', speakerColor(group.group, script.groups));
        const name = el('span', 'anomalous-sd-tune-person-name');
        name.append(el('span', 'anomalous-sd-speaker-dot'), el('span', '', group.character));
        name.firstChild.style.background = speakerColor(group.group, script.groups);
        const about = el('span', 'anomalous-sd-tune-person-about', valuesText(ctx.view, ctx.options(group)));
        const count = el('span', 'anomalous-sd-tune-person-count', t('scriptTuneLineCount', { count: lines.length }));
        item.append(name, count, about);
        if (own) item.append(el('span', 'anomalous-sd-tune-person-own', t('scriptTuneOwnCount', { count: own })));
        list.append(item);
    }
    parts.push(list, el('div', 'anomalous-sd-run-note', t('scriptTuneScriptHint')), links(ctx, null));
    return parts;
}

/** One character in this script: its language, speed and mode, for every line of it that follows. */
function renderCharacterView(ctx, group) {
    const { script } = ctx;
    const values = ctx.options(group);
    const indexes = script.lines.map((line, index) => [line, index]).filter(([line]) => line.text.trim() && script.speakerOf(line) === group).map(([, index]) => index);
    const meta = indexes.length ? t('scriptTuneCharacterMeta', { lines: lineNumbers(indexes), count: indexes.length }) : t('scriptTuneCharacterNone');
    const parts = [heading(t('scriptTuneCharacter', { name: group.character }), meta, script.focusScript)];
    const set = (field, value) => ctx.setCharacter(group, field, value);
    parts.push(row(t('scriptRunLanguage'), segment(LANGUAGES.map(code => ({ id: code, label: t(`scriptRunLang_${code}`) })),
        code => values.language === code, code => set('language', code), ctx.busy)));
    parts.push(speedSlider(ctx, values.speed, value => set('speed', value)));
    // The line heard: the one listened to on the left when it is this character's, else its first.
    const listened = script.lines[script.listen];
    const line = listened && script.speakerOf(listened) === group ? listened : (script.lines[indexes[0]] || null);
    const lang = ctx.autoLanguage(group, values);
    parts.push(modeBox(ctx, {
        speaker: group,
        line,
        values,
        selected: values.preset,
        choices: presetChoices(ctx.view),
        base: AUTO_MODE,
        baseName: t('scriptRunModeAutoBase'),
        baseText: t('scriptRunModeIsAuto'),
        describe: id => (id === AUTO_MODE ? t('scriptRunModeAutoShort', { lang }) : t('scriptRunModeWhole', { about: presetAbout(id) })),
        numbers: id => ctx.modeNumbers(group, values, id),
        onPick: id => set('preset', id),
    }));
    parts.push(el('div', 'anomalous-sd-run-note', t('scriptTuneCharacterHint')));
    const own = indexes.filter(index => hasOwnTune(script.lines[index]));
    const foot = el('div', 'anomalous-sd-run-links');
    if (ctx.canSave(group)) foot.append(ctx.saveButton(group));
    if (own.length) foot.append(button('anomalous-sd-link-btn', t('scriptTuneResetLines', { count: own.length }), () => ctx.clearLines(own)));
    if (foot.childNodes.length) parts.push(foot);
    parts.push(links(ctx, group));
    return parts;
}

/** Picked lines: who reads them, then each value following its character until set here. */
function renderLinesView(ctx, indexes) {
    const { script } = ctx;
    const lines = indexes.map(index => script.lines[index]).filter(Boolean);
    const speakers = [...new Set(lines.map(line => script.speakerOf(line)).filter(Boolean))];
    const single = speakers.length === 1 ? speakers[0] : null;
    const title = lines.length === 1 ? t('scriptTuneLine', { n: indexes[0] + 1 }) : t('scriptTuneLines', { count: lines.length });
    const meta = single ? t('scriptTuneReadBy', { name: single.character })
        : speakers.map(group => `${group.character} ${lines.filter(line => script.speakerOf(line) === group).length}`).join(' · ');
    const parts = [heading(title, meta, script.focusScript)];
    const valuesOf = line => ctx.lineValues(line);
    const set = (field, value) => ctx.setLines(indexes, field, value);
    const followText = field => {
        if (!single) return t('scriptTuneFollowEach');
        const value = ctx.options(single)[field];
        return field === 'speed' ? speedText(value) : field === 'language' ? t(`scriptRunLang_${value}`) : modeName(ctx.view, value);
    };

    if (script.groups.length > 1) {
        const who = segment(script.groups.map(group => ({ id: group.group, label: group.character, className: 'anomalous-sd-tune-who' })),
            key => speakers.length === 1 && single.group === key, key => script.assign(indexes, key), ctx.busy);
        who.querySelectorAll('.anomalous-sd-tune-who').forEach((chip, at) => chip.style.setProperty('--speaker', speakerColor(script.groups[at].group, script.groups)));
        parts.push(row(t('scriptTuneWho'), who));
    }

    const language = sharedValue(lines, 'language', valuesOf);
    const languageChoices = [{ id: FOLLOW, label: t('scriptTuneFollowValue', { value: followText('language') }), title: t('scriptTuneFollowHint') },
        ...LANGUAGES.map(code => ({ id: code, label: t(`scriptRunLang_${code}`) }))];
    parts.push(row(t('scriptRunLanguage'), segment(languageChoices,
        id => (id === FOLLOW ? !language.some : language.own && !language.mixed && language.value === id),
        id => set('language', id === FOLLOW ? undefined : id), ctx.busy)));

    const speed = sharedValue(lines, 'speed', valuesOf);
    const speedAfter = speed.some
        ? [button('anomalous-sd-icon-btn anomalous-sd-tune-reset', '↺', () => set('speed', undefined), t('scriptTuneReset'))]
        : [el('span', 'anomalous-sd-tune-follow', t('scriptTuneFollowing'))];
    parts.push(speedSlider(ctx, speed.mixed ? null : speed.value, value => set('speed', value), speedAfter));

    if (ctx.view) {
        const mode = sharedValue(lines, 'preset', valuesOf);
        const selected = !mode.some ? FOLLOW : (mode.own && !mode.mixed ? mode.value : null);
        const speaker = single || speakers[0];
        const heard = lines.includes(script.lines[script.listen]) ? script.lines[script.listen] : lines[0];
        const followName = single ? single.character : t('scriptTuneFollowEach');
        parts.push(modeBox(ctx, {
            speaker: script.speakerOf(heard) || speaker,
            line: heard,
            selected: selected ?? FOLLOW,
            choices: [{ id: FOLLOW, label: t('scriptTuneFollowValue', { value: followText('preset') }) }, ...presetChoices(ctx.view)],
            base: FOLLOW,
            baseName: t('scriptTuneFollowBase', { name: followName }),
            baseText: t('scriptTuneModeFollow', { name: followName }),
            describe: id => (id === FOLLOW ? '' : id === AUTO_MODE ? t('scriptRunModeAutoShort', { lang: ctx.autoLanguage(speaker, valuesOf(heard)) })
                : t('scriptTuneModeLines', { about: presetAbout(id) })),
            numbers: id => {
                const owner = script.speakerOf(heard) || speaker;
                const values = valuesOf(heard);
                return ctx.modeNumbers(owner, values, id === FOLLOW ? ctx.options(owner).preset : id);
            },
            onPick: id => set('preset', id === FOLLOW ? undefined : id),
        }));
    }
    if (lines.some(hasOwnTune)) {
        const foot = el('div', 'anomalous-sd-run-links');
        foot.append(button('anomalous-sd-link-btn', t('scriptTuneResetAll'), () => ctx.clearLines(indexes)));
        parts.push(foot);
    }
    parts.push(links(ctx, single));
    return parts;
}

/**
 * Draws the panel into `box`. `ctx`: `script` (the director's: lines, groups, speakerOf, listen,
 * picked indexes, focus `{ character }` or null, assign / focusCharacter / focusScript), `view` (the
 * presets or null), `spec`, `busy`, `local`, `roomy`, `canTag` (the node reads a line's own values),
 * `presetNote`, `preview`, and the run section's calls: `options(group)` (its values in this script),
 * `lineValues(line)`, `setCharacter(group, field, value)`, `setLines(indexes, field, value)`,
 * `clearLines(indexes)`, `modeNumbers(group, values, id)`, `autoLanguage(group, values)`,
 * `takeFor(line, mode, speaker, values)`, `editPreset`, `canSave(group)`, `saveButton(group)`,
 * `openPresets()`, `openTuning(group)`.
 */
export function renderTunePanel(box, ctx) {
    const { script } = ctx;
    const group = script.focus?.character ? script.groups.find(item => item.group === script.focus.character) : null;
    let parts;
    if (script.picked.length) parts = renderLinesView(ctx, script.picked);
    else if (group) parts = renderCharacterView(ctx, group);
    else parts = renderScriptView(ctx);
    if (!ctx.canTag && (script.picked.length || group)) {
        parts.splice(1, 0, el('div', 'anomalous-sd-run-hint is-warning', t('scriptTuneOldTts')));
    }
    box.replaceChildren(...parts);
}
