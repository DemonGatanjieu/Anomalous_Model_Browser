import { t } from './interface_settings.js';
import { button, el } from './usage_view.js';
import { isBuiltin, presetLabel } from './tts_presets_api.js';
import { AUTO_MODE, hasOwnTune, lineNumbers, ownTune, sharedValue } from './script_tune.js';
import { speakerColor } from './ui_script_cast.js';
import { openSpeakerMenu } from './ui_script_cards.js';
import { renderPresetSwitch } from './ui_tts_preset_switch.js';
import { remember, remembered, tabStrip } from './ui_tab_strip.js';

/**
 * The Script Director's side panel, which follows what is picked on the left: nothing, the whole
 * script (each character and how it reads); a character in the cast, how it reads in this script
 * (every line of it follows); picked lines, who reads them and how, each value following the
 * character until it is set here (then the card shows a tag and ↺ lets it follow again).
 * A character or picked lines have three tabs: How it reads (who reads, speed, the language as one
 * line while it is detected, the tone with its listen button), Numbers and Settings.
 * ui_script_run.js keeps the state and draws this again after each change (`ctx`, see
 * renderTunePanel); the lines are the director's.
 */

export const LANGUAGES = ['auto', 'zh', 'ja', 'en'];
const FOLLOW = '__follow'; // a line's mode choice: its character's
const ALL_WHO_UP_TO = 6;   // more characters than this: "Who reads" lists the script's own, the rest in a menu
const TABS = ['how', 'numbers', 'settings'];
const TAB_KEY = 'anomalous_sd_tune_tab';

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

function heading(title, meta, back, hint = '') {
    const head = el('div', 'anomalous-sd-tune-head');
    if (hint) head.title = hint;
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
        if (choice.color) {
            const dot = el('span', 'anomalous-sd-speaker-dot');
            dot.style.background = choice.color;
            chip.prepend(dot);
            chip.style.setProperty('--speaker', choice.color);
        }
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
 * The language: one line ("Language: detected · Change") while it is the detected one and nothing
 * set it, the choices once "Change" is pressed or another one is in use. `choices` and `checked`
 * as segment; `shown`: the language in use, in words.
 */
function languageRow(ctx, { choices, checked, onPick, open, shown }) {
    const full = () => row(t('scriptRunLanguage'), segment(choices, checked, onPick, ctx.busy));
    if (open) return full();
    const line = el('div', 'anomalous-sd-tune-language');
    const change = button('anomalous-sd-link-btn', t('scriptTuneLanguageChange'), () => line.replaceWith(full()));
    change.disabled = ctx.busy;
    line.append(el('span', '', t('scriptTuneLanguageIs', { value: shown })), change);
    return line;
}

/**
 * The tone: its choices and ▶ for the line heard (null: a sample) read by `speaker` with `values`
 * (null: the line's own); with `detail` (the Numbers tab) also how it compares and its numbers.
 * `choices` and `base` as renderPresetSwitch.
 */
function modeBox(ctx, { speaker, line, values = null, selected, choices, base, baseName, baseText, describe, numbers, onPick, detail = false }) {
    const box = el('div', 'anomalous-sd-run-mode');
    if (!ctx.view) return box;
    const view = ctx.view;
    const take = id => ctx.takeFor(line, id === FOLLOW ? ctx.options(speaker).preset : id, speaker, values);
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
        listen: ctx.preview.row({ takeFor: take, selected, modes: choices, onPick, disabled: ctx.busy, label: 'scriptTuneListen' }),
        detail,
        disabled: ctx.busy,
    });
    box.append(el('span', 'anomalous-sd-run-label', t('scriptRunMode')), switcher);
    if (detail && ctx.presetNote) box.append(el('div', 'anomalous-sd-run-note', ctx.presetNote));
    return box;
}

const presetChoices = view => [{ id: AUTO_MODE, label: t('scriptRunModeAuto') },
    ...Object.keys(view?.presets || {}).map(name => ({ id: name, label: presetLabel(view.labels, name, t), badge: isBuiltin(name) ? '' : t('ttsPresetCustom') }))];

const presetAbout = id => (isBuiltin(id) ? t(`ttsPresetDesc_${id}`) : t('ttsPresetDescCustom'));

/** The Settings tab's ways out: the tones for every character, and this one's own settings. */
function links(ctx, speaker) {
    const box = el('div', 'anomalous-sd-tune-links');
    const item = (label, about, onClick) => {
        const entry = button('anomalous-sd-tune-link', '', onClick);
        entry.append(el('span', 'anomalous-sd-tune-link-name', label), el('span', 'anomalous-sd-tune-link-about', about));
        box.append(entry);
    };
    item(t('scriptRunOpenPresets'), t('scriptTuneLinkPresets'), ctx.openPresets);
    if (speaker) item(t('scriptRunOpenTuning', { name: speaker.character }), t('scriptTuneLinkTuning'), () => ctx.openTuning(speaker));
    return box;
}

/** Each character reading in this script, a click opens it. */
function renderScriptView(ctx) {
    const { script } = ctx;
    const spoken = script.lines.filter(line => line.text.trim());
    const cast = script.groups.filter(group => spoken.some(line => script.speakerOf(line) === group));
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
    return {
        head: heading(t('scriptTuneScript'), t('scriptTuneScriptMeta', { count: spoken.length, speakers: cast.length })),
        body: [list, el('div', 'anomalous-sd-run-note', t('scriptTuneScriptHint')), links(ctx, null)],
    };
}

/** One character in this script, for every line of it that follows: speed, language and tone, its numbers, its settings. */
function renderCharacterView(ctx, group, tab) {
    const { script } = ctx;
    const values = ctx.options(group);
    const indexes = script.lines.map((line, index) => [line, index]).filter(([line]) => line.text.trim() && script.speakerOf(line) === group).map(([, index]) => index);
    const meta = indexes.length ? t('scriptTuneCharacterMeta', { lines: lineNumbers(indexes), count: indexes.length }) : t('scriptTuneCharacterNone');
    const head = heading(t('scriptTuneCharacter', { name: group.character }), meta, script.focusScript, t('scriptTuneCharacterHint'));
    const set = (field, value) => ctx.setCharacter(group, field, value);
    // The line heard: the one listened to on the left when it is this character's, else its first.
    const listened = script.lines[script.listen];
    const line = listened && script.speakerOf(listened) === group ? listened : (script.lines[indexes[0]] || null);
    const lang = ctx.autoLanguage(group, values);
    const mode = detail => modeBox(ctx, {
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
        detail,
    });
    if (tab === 'numbers') return { head, body: [mode(true)] };
    if (tab === 'settings') {
        const own = indexes.filter(index => hasOwnTune(script.lines[index]));
        const keep = el('div', 'anomalous-sd-run-links');
        keep.append(ctx.canSave(group) ? ctx.saveButton(group) : el('span', 'anomalous-sd-tune-follow', t('scriptTuneIsDefault')));
        if (own.length) keep.append(button('anomalous-sd-link-btn', t('scriptTuneResetLines', { count: own.length }), () => ctx.clearLines(own)));
        return { head, body: [keep, el('div', 'anomalous-sd-run-note', t('scriptRunSaveDefaultsHint')), links(ctx, group)] };
    }
    return {
        head,
        body: [
            speedSlider(ctx, values.speed, value => set('speed', value)),
            languageRow(ctx, {
                choices: LANGUAGES.map(code => ({ id: code, label: t(`scriptRunLang_${code}`) })),
                checked: code => values.language === code,
                onPick: code => set('language', code),
                open: values.language !== 'auto',
                shown: t(`scriptRunLang_${values.language}`),
            }),
            mode(false),
        ],
    };
}

/**
 * Who reads the picked lines: every character when there are a few; with many, the ones reading
 * in this script (and the picked lines' own), the others in a menu with a search box.
 */
function whoReads(ctx, indexes, speakers) {
    const { script } = ctx;
    const reading = new Set([...script.lines.filter(line => line.text.trim()).map(line => script.speakerOf(line)), ...speakers]);
    const many = script.groups.length > ALL_WHO_UP_TO;
    const listed = many ? script.groups.filter(group => reading.has(group)) : script.groups;
    const others = many ? script.groups.filter(group => !reading.has(group)) : [];
    const assign = key => script.assign(indexes, key);
    const box = segment(listed.map(group => ({
        id: group.group, label: group.character, className: 'anomalous-sd-tune-who', color: speakerColor(group.group, script.groups),
    })), key => speakers.length === 1 && speakers[0].group === key, assign, ctx.busy);
    if (others.length) {
        const more = button('anomalous-sd-run-choice anomalous-sd-tune-more', t('scriptTuneOtherCharacters', { count: others.length }),
            () => openSpeakerMenu(more, script.groups, null, assign, others));
        more.disabled = ctx.busy;
        box.append(more);
    }
    return box;
}

/** Picked lines: who reads them, then each value following its character until set here; the tone's numbers; the settings. */
function renderLinesView(ctx, indexes, tab) {
    const { script } = ctx;
    const lines = indexes.map(index => script.lines[index]).filter(Boolean);
    const speakers = [...new Set(lines.map(line => script.speakerOf(line)).filter(Boolean))];
    const single = speakers.length === 1 ? speakers[0] : null;
    const title = lines.length === 1 ? t('scriptTuneLine', { n: indexes[0] + 1 }) : t('scriptTuneLines', { count: lines.length });
    const meta = single ? t('scriptTuneReadBy', { name: single.character })
        : speakers.map(group => `${group.character} ${lines.filter(line => script.speakerOf(line) === group).length}`).join(' · ');
    const head = heading(title, meta, script.focusScript);
    const valuesOf = line => ctx.lineValues(line);
    const set = (field, value) => ctx.setLines(indexes, field, value);
    const followText = field => {
        if (!single) return t('scriptTuneFollowEach');
        const value = ctx.options(single)[field];
        return field === 'speed' ? speedText(value) : field === 'language' ? t(`scriptRunLang_${value}`) : modeName(ctx.view, value);
    };
    const resetAll = () => {
        if (!lines.some(hasOwnTune)) return [];
        const foot = el('div', 'anomalous-sd-run-links');
        foot.append(button('anomalous-sd-link-btn', t('scriptTuneResetAll'), () => ctx.clearLines(indexes)));
        return [foot];
    };

    const mode = (detail) => {
        if (!ctx.view) return el('div');
        const shared = sharedValue(lines, 'preset', valuesOf);
        const selected = !shared.some ? FOLLOW : (shared.own && !shared.mixed ? shared.value : FOLLOW);
        const speaker = single || speakers[0];
        const heard = lines.includes(script.lines[script.listen]) ? script.lines[script.listen] : lines[0];
        const followName = single ? single.character : t('scriptTuneFollowEach');
        return modeBox(ctx, {
            speaker: script.speakerOf(heard) || speaker,
            line: heard,
            selected,
            // "Usual" would read like "As the character" here: a line picks a tone or follows.
            choices: [{ id: FOLLOW, label: t('scriptTuneFollow'), title: t('scriptTuneFollowHint', { value: followText('preset') }) },
                ...presetChoices(ctx.view).filter(choice => choice.id !== AUTO_MODE || selected === AUTO_MODE)],
            base: FOLLOW,
            baseName: t('scriptTuneFollowBase', { name: followName }),
            baseText: t('scriptTuneModeFollow', { name: followName }),
            describe: id => (id === FOLLOW ? '' : id === AUTO_MODE ? t('scriptRunModeAutoShort', { lang: ctx.autoLanguage(speaker, valuesOf(heard)) })
                : t('scriptTuneModeLines', { about: presetAbout(id) })),
            numbers: id => {
                const owner = script.speakerOf(heard) || speaker;
                return ctx.modeNumbers(owner, valuesOf(heard), id === FOLLOW ? ctx.options(owner).preset : id);
            },
            onPick: id => set('preset', id === FOLLOW ? undefined : id),
            detail,
        });
    };
    if (tab === 'numbers') return { head, body: [mode(true)] };
    if (tab === 'settings') return { head, body: [...resetAll(), links(ctx, single)] };

    const body = [];
    if (script.groups.length > 1) body.push(row(t('scriptTuneWho'), whoReads(ctx, indexes, speakers)));
    const speed = sharedValue(lines, 'speed', valuesOf);
    const speedAfter = speed.some
        ? [button('anomalous-sd-icon-btn anomalous-sd-tune-reset', '↺', () => set('speed', undefined), t('scriptTuneReset'))]
        : [el('span', 'anomalous-sd-tune-follow', t('scriptTuneFollowing'))];
    body.push(speedSlider(ctx, speed.mixed ? null : speed.value, value => set('speed', value), speedAfter));
    const language = sharedValue(lines, 'language', valuesOf);
    const follow = { id: FOLLOW, label: t('scriptTuneFollow'), title: t('scriptTuneFollowHint', { value: followText('language') }) };
    body.push(languageRow(ctx, {
        choices: [follow, ...LANGUAGES.map(code => ({ id: code, label: t(`scriptRunLang_${code}`) }))],
        checked: id => (id === FOLLOW ? !language.some : language.own && !language.mixed && language.value === id),
        onPick: id => set('language', id === FOLLOW ? undefined : id),
        open: language.some || language.mixed || language.value !== 'auto',
        shown: t('scriptTuneFollowValue', { value: followText('language') }),
    }));
    body.push(mode(false), ...resetAll());
    return { head, body };
}

/**
 * Draws the panel into `box`: the heading, then for a character or picked lines three tabs, How
 * it reads, Numbers (the tone compared, its numbers editable) and Settings (keeping it, the ways
 * to the tones and the character's own settings); the tab is remembered. `ctx`: `script` (the
 * director's: lines, groups, speakerOf, listen, picked indexes, focus `{ character }` or null,
 * assign / focusCharacter / focusScript), `view` (the presets or null), `spec`, `busy`, `local`,
 * `canTag` (the node reads a line's own values), `presetNote`, `preview`, `redraw()`, and the run
 * section's calls: `options(group)` (its values in this script), `lineValues(line)`,
 * `setCharacter(group, field, value)`, `setLines(indexes, field, value)`, `clearLines(indexes)`,
 * `modeNumbers(group, values, id)`, `autoLanguage(group, values)`, `takeFor(line, mode, speaker,
 * values)`, `editPreset`, `canSave(group)`, `saveButton(group)`, `openPresets()`, `openTuning(group)`.
 */
export function renderTunePanel(box, ctx) {
    const { script } = ctx;
    const group = script.focus?.character ? script.groups.find(item => item.group === script.focus.character) : null;
    const tab = remembered(TAB_KEY, TABS, 'how');
    let view;
    if (script.picked.length) view = renderLinesView(ctx, script.picked, tab);
    else if (group) view = renderCharacterView(ctx, group, tab);
    else view = renderScriptView(ctx);
    const parts = [view.head];
    if (!ctx.canTag && (script.picked.length || group)) parts.push(el('div', 'anomalous-sd-run-hint is-warning', t('scriptTuneOldTts')));
    if (script.picked.length || group) {
        parts.push(tabStrip(TABS.map(id => ({ id, label: t(`scriptTuneTab_${id}`) })), tab, (id) => {
            remember(TAB_KEY, id);
            ctx.redraw();
        }));
    }
    box.replaceChildren(...parts, ...view.body);
}
