import { t } from './interface_settings.js';
import { button, el } from './usage_view.js';
import { isBuiltin, presetLabel } from './tts_presets_api.js';
import { AUTO_MODE, hasOwnTune, lineNumbers, ownTune, sharedValue } from './script_tune.js';
import { speakerColor } from './ui_script_cast.js';
import { openSpeakerMenu } from './ui_script_cards.js';
import { renderPresetSwitch } from './ui_tts_preset_switch.js';
import { remember, remembered } from './ui_tab_strip.js';

/**
 * The Script Director's side panel, in three layers for this script, each read the same way:
 * the whole script (what everyone reads with), a character in the cast (only its lines), the
 * picked lines (only them). On top a path, Whole script › character › line, says which layer is
 * being changed and leads back up. Each layer has the same three rows, speed, tone and language,
 * and each row says where its value comes from (this line, the character, the whole script, the
 * character's usual settings, the default; a click there goes to that layer) with ↺ when this
 * layer set it. Setting a value to what it would get anyway lets it follow again. Settings that
 * last beyond this script (the tones, a character's own settings) are links at the foot.
 * ui_script_run.js keeps the state and draws this again after each change (`ctx`, see
 * renderTunePanel); the lines are the director's.
 */

export const LANGUAGES = ['auto', 'zh', 'ja', 'en'];
const ALL_WHO_UP_TO = 6; // more characters than this: "Who reads" lists the script's own, the rest in a menu
const NUMBERS_KEY = 'anomalous_sd_tone_numbers';

/** "1.2×" */
export const speedText = speed => `${Math.round(Number(speed) * 100) / 100}×`;

/** A tone's name: the usual one, a built-in preset or one made in Anomalous. */
export function modeName(view, id) {
    return id === AUTO_MODE || !view ? t('scriptRunModeAuto') : presetLabel(view.labels, id, t);
}

/** "中文 · 1.2× · 生动": a set of values in a few words. */
export function valuesText(view, values) {
    return [t(`scriptRunLang_${values.language || 'auto'}`), speedText(values.speed), modeName(view, values.preset ?? AUTO_MODE)].join(' · ');
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

/** The path on top: Whole script › character › lines; `steps`: `[{ label, go?, current? }]`. */
function path(steps) {
    const box = el('nav', 'anomalous-sd-tune-path');
    steps.forEach((step, at) => {
        if (at) box.append(el('span', 'anomalous-sd-tune-path-sep', '›'));
        // The first step is the way back up: the browser's Esc presses it (ui_browser_navigation.js).
        const item = step.go && !step.current
            ? button(`anomalous-sd-tune-path-step${at === 0 ? ' anomalous-sd-tune-back' : ''}`, step.label, step.go)
            : el('span', `anomalous-sd-tune-path-step${step.current ? ' is-current' : ''}`, step.label);
        if (step.color) item.style.setProperty('--speaker', step.color);
        box.append(item);
    });
    return box;
}

/**
 * Where a value comes from, as a chip in the layer's colour: `from` ('line', 'character',
 * 'script', 'usual', 'default'), `who` the character's name; a click goes to that layer.
 */
function sourceChip(ctx, from, who, go, mixed = false) {
    if (mixed) return el('span', 'anomalous-sd-tune-from is-mixed', t('scriptTuneFromMixed'));
    const label = {
        line: t('scriptTuneFromLine'),
        character: who,
        script: t('scriptTuneScript'),
        usual: t('scriptTuneFromUsual', { name: who }),
        default: t('scriptTuneFromDefault'),
    }[from];
    const target = go?.[from];
    const chip = target ? button(`anomalous-sd-tune-from is-${from}`, label, target) : el('span', `anomalous-sd-tune-from is-${from}`, label);
    chip.title = t(`scriptTuneFromHint_${from}`, { name: who });
    return chip;
}

/** One row: its name, the control, where the value comes from, and ↺ when this layer set it (`reset`). */
function row(label, control, chip, reset) {
    const line = el('div', 'anomalous-sd-tune-row');
    const end = el('span', 'anomalous-sd-tune-row-end');
    end.append(chip);
    if (reset) end.append(button('anomalous-sd-icon-btn anomalous-sd-tune-reset', '↺', reset, t('scriptTuneReset')));
    line.append(el('span', 'anomalous-sd-run-label', label), control, end);
    return line;
}

/** The speed slider; `value` null when the lines differ. */
function speedSlider(ctx, value, onChange) {
    const range = ctx.spec.speed;
    const box = el('span', 'anomalous-sd-tune-speed');
    const slider = el('input', 'anomalous-sd-run-slider');
    Object.assign(slider, { type: 'range', min: String(range.min), max: String(range.max), step: String(range.step ?? 1) });
    slider.value = String(value ?? range.default);
    slider.title = t('scriptRunParamHint_speed');
    slider.disabled = ctx.busy;
    const shown = el('span', 'anomalous-sd-run-value', value === null ? '–' : speedText(value));
    slider.oninput = () => { shown.textContent = speedText(slider.value); };
    slider.onchange = () => {
        const number = Math.min(range.max, Math.max(range.min, Number(slider.value)));
        onChange(Number.isFinite(number) ? number : range.default);
    };
    box.append(slider, shown);
    return box;
}

const toneChoices = view => [{ id: AUTO_MODE, label: t('scriptRunModeAuto'), title: t('scriptTuneUsualHint') },
    ...Object.keys(view?.presets || {}).map(name => ({ id: name, label: presetLabel(view.labels, name, t), badge: isBuiltin(name) ? '' : t('ttsPresetCustom') }))];

const presetAbout = id => (isBuiltin(id) ? t(`ttsPresetDesc_${id}`) : t('ttsPresetDescCustom'));

/**
 * The three rows for one layer. `value(field)` → `{ value, from, mixed }`, `set(field, value)`
 * (undefined: follow the layer below), `own(field)`: this layer set it; `who`: the character the
 * sources name; `go`: where a source chip leads; `speaker` / `line`: who is heard on ▶ and which
 * line (null: a sample); `values`: the values heard with (null: the line's own).
 */
function layerRows(ctx, { value, set, own, who, go, speaker, line, values = null }) {
    const reset = field => (own(field) ? () => set(field, undefined) : null);
    const chip = field => sourceChip(ctx, value(field).from, who, go, value(field).mixed);
    const rows = [];

    const speed = value('speed');
    rows.push(row(t('scriptRunSpeed'), speedSlider(ctx, speed.mixed ? null : speed.value, number => set('speed', number)), chip('speed'), reset('speed')));

    if (ctx.view) {
        const tone = value('preset');
        const detail = remembered(NUMBERS_KEY, ['simple', 'numbers'], 'simple') === 'numbers';
        const lang = ctx.autoLanguage(speaker, values || ctx.lineValues(line) || {});
        const take = id => ctx.takeFor(line, id, speaker, values);
        const switcher = renderPresetSwitch({
            choices: toneChoices(ctx.view),
            selected: tone.mixed ? null : tone.value,
            base: AUTO_MODE,
            baseName: t('scriptRunModeAutoBase'),
            baseText: t('scriptRunModeIsAuto'),
            values: id => ctx.modeNumbers(speaker, values || ctx.lineValues(line), id ?? AUTO_MODE),
            describe: id => (id === AUTO_MODE ? t('scriptRunModeAutoShort', { lang }) : presetAbout(id)),
            builtin: id => (isBuiltin(id) ? ctx.view.builtin[id] : null),
            editable: id => id !== AUTO_MODE && ctx.local,
            onPick: id => set('preset', id),
            onEdit: ctx.editPreset,
            detail,
            disabled: ctx.busy,
        });
        rows.push(row(t('scriptRunMode'), switcher, chip('preset'), reset('preset')));
        const under = el('div', 'anomalous-sd-tune-under');
        const numbers = button(`anomalous-sd-run-choice anomalous-sd-tune-numbers${detail ? ' is-on' : ''}`, t('scriptTuneNumbers'), () => {
            remember(NUMBERS_KEY, detail ? 'simple' : 'numbers');
            ctx.redraw();
        });
        numbers.setAttribute('aria-pressed', String(detail));
        // Without a line of its own in the script (a character with none yet), ▶ reads a sample
        // sentence, and says so: it is not a line of the script.
        const lead = line ? [] : [el('span', 'anomalous-sd-tune-sample', t('scriptTuneListenSampleNote', { name: speaker?.character || '' }))];
        under.append(ctx.preview.row({
            takeFor: take, selected: tone.mixed ? AUTO_MODE : tone.value, modes: toneChoices(ctx.view),
            onPick: id => set('preset', id), disabled: ctx.busy, label: line ? 'scriptTuneListen' : 'scriptTuneListenSample', lead,
        }), numbers);
        rows.push(under);
        if (detail && ctx.presetNote) rows.push(el('div', 'anomalous-sd-run-note', ctx.presetNote));
    }

    const language = value('language');
    rows.push(row(t('scriptRunLanguage'),
        segment(LANGUAGES.map(code => ({ id: code, label: t(`scriptRunLang_${code}`) })), code => !language.mixed && language.value === code, code => set('language', code), ctx.busy),
        chip('language'), reset('language')));
    return rows;
}

/** The foot: the settings that last beyond this script. */
function lasting(ctx, speaker) {
    const box = el('div', 'anomalous-sd-tune-lasting');
    box.append(el('span', '', t('scriptTuneLasting')),
        button('anomalous-sd-link-btn', t('scriptRunOpenPresets'), ctx.openPresets));
    if (speaker) box.append(button('anomalous-sd-link-btn', t('scriptRunOpenTuning', { name: speaker.character }), () => ctx.openTuning(speaker)));
    return box;
}

function resetLink(label, onClick) {
    const box = el('div', 'anomalous-sd-run-links');
    box.append(button('anomalous-sd-link-btn', label, onClick));
    return box;
}

/** The whole script: what everyone reads with, then each character in it (a click opens it). */
function renderScriptView(ctx) {
    const { script } = ctx;
    const layer = ctx.layers.script();
    const spoken = script.lines.filter(line => line.text.trim());
    const cast = script.groups.filter(group => spoken.some(line => script.speakerOf(line) === group));
    const first = cast[0] || script.group;
    const parts = [
        path([{ label: t('scriptTuneScript'), current: true }]),
        el('div', 'anomalous-sd-tune-meta', t('scriptTuneScriptMeta', { count: spoken.length, speakers: cast.length })),
        ...layerRows(ctx, {
            value: field => ({ value: layer.values[field], from: layer.from[field] }),
            set: ctx.setScript,
            own: field => layer.from[field] === 'script',
            who: '',
            go: {},
            // The line heard is read by its own character, with the whole script's values.
            speaker: script.lines[script.listen] ? script.speakerOf(script.lines[script.listen]) || first : first,
            line: script.lines[script.listen] || null,
            values: layer.values,
        }),
    ];
    if (ctx.changedFor.script()) parts.push(resetLink(t('scriptTuneResetScript'), ctx.clearScript));
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
        const changed = [ctx.changedFor.character(group) ? t('scriptTuneChangedHere') : '', own ? t('scriptTuneOwnCount', { count: own }) : ''].filter(Boolean);
        if (changed.length) item.append(el('span', 'anomalous-sd-tune-person-own', changed.join(' · ')));
        list.append(item);
    }
    parts.push(el('div', 'anomalous-sd-tune-section', t('scriptTuneCast')), list, lasting(ctx, null));
    return parts;
}

/** One character in this script: its three rows for every line of it that follows. */
function renderCharacterView(ctx, group) {
    const { script } = ctx;
    const layer = ctx.layers.character(group);
    const indexes = script.lines.map((line, index) => [line, index]).filter(([line]) => line.text.trim() && script.speakerOf(line) === group).map(([, index]) => index);
    const listened = script.lines[script.listen];
    const line = listened && script.speakerOf(listened) === group ? listened : (script.lines[indexes[0]] || null);
    const parts = [
        path([{ label: t('scriptTuneScript'), go: script.focusScript }, { label: group.character, current: true, color: speakerColor(group.group, script.groups) }]),
        el('div', 'anomalous-sd-tune-meta', indexes.length ? t('scriptTuneCharacterMeta', { lines: lineNumbers(indexes), count: indexes.length }) : t('scriptTuneCharacterNone')),
        ...layerRows(ctx, {
            value: field => ({ value: layer.values[field], from: layer.from[field] }),
            set: (field, value) => ctx.setCharacter(group, field, value),
            own: field => layer.from[field] === 'character',
            who: group.character,
            go: { script: script.focusScript },
            speaker: group,
            line,
            values: layer.values,
        }),
    ];
    const own = indexes.filter(index => hasOwnTune(script.lines[index]));
    const links = el('div', 'anomalous-sd-run-links');
    if (ctx.changedFor.character(group)) links.append(button('anomalous-sd-link-btn', t('scriptTuneResetCharacter'), () => ctx.clearCharacter(group)));
    if (own.length) links.append(button('anomalous-sd-link-btn', t('scriptTuneResetLines', { count: own.length }), () => ctx.clearLines(own)));
    if (ctx.canSave(group)) links.append(ctx.saveButton(group));
    if (links.childNodes.length) parts.push(links);
    parts.push(lasting(ctx, group));
    return parts;
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

/** Picked lines: who reads them, then their three rows, each following the character until set here. */
function renderLinesView(ctx, indexes) {
    const { script } = ctx;
    const lines = indexes.map(index => script.lines[index]).filter(Boolean);
    const speakers = [...new Set(lines.map(line => script.speakerOf(line)).filter(Boolean))];
    const single = speakers.length === 1 ? speakers[0] : null;
    const title = lines.length === 1 ? t('scriptTuneLine', { n: indexes[0] + 1 }) : t('scriptTuneLines', { count: lines.length });
    const layers = lines.map(line => ctx.layers.line(line));
    const heard = lines.includes(script.lines[script.listen]) ? script.lines[script.listen] : lines[0];
    const value = (field) => {
        const shared = sharedValue(lines, field, line => ctx.lineValues(line));
        const froms = new Set(layers.map(layer => layer.from[field]));
        return { value: shared.value, mixed: shared.mixed || froms.size > 1, from: [...froms][0] };
    };
    const steps = [{ label: t('scriptTuneScript'), go: script.focusScript }];
    if (single) steps.push({ label: single.character, go: () => script.focusCharacter(single.group), color: speakerColor(single.group, script.groups) });
    steps.push({ label: title, current: true });
    const parts = [path(steps)];
    if (script.groups.length > 1) {
        const who = el('div', 'anomalous-sd-tune-row');
        who.append(el('span', 'anomalous-sd-run-label', t('scriptTuneWho')), whoReads(ctx, indexes, speakers));
        parts.push(who);
    }
    parts.push(...layerRows(ctx, {
        value,
        set: (field, next) => ctx.setLines(indexes, field, next),
        own: field => lines.some(line => ownTune(line)[field] !== undefined),
        who: single?.character || '',
        go: single ? { character: () => script.focusCharacter(single.group), usual: () => script.focusCharacter(single.group), script: script.focusScript } : { script: script.focusScript },
        speaker: script.speakerOf(heard) || single,
        line: heard,
    }));
    if (lines.some(hasOwnTune)) parts.push(resetLink(t('scriptTuneResetAll'), () => ctx.clearLines(indexes)));
    parts.push(lasting(ctx, single));
    return parts;
}

/**
 * Draws the panel into `box`: the picked lines' layer, else the character's shown, else the whole
 * script's. `ctx`: `script` (the director's: lines, groups, group, speakerOf, listen, picked
 * indexes, focus `{ character }` or null, assign / focusCharacter / focusScript), `view` (the
 * presets or null), `spec`, `busy`, `local`, `canTag` (the node reads a line's own values),
 * `presetNote`, `preview`, `redraw()`, and the run section's calls: `layers` (`script()`,
 * `character(group)`, `line(line)`, each `{ values, from }`), `changedFor` (`script()`,
 * `character(group)`), `options(group)`, `lineValues(line)`, `setScript(field, value)`,
 * `setCharacter(group, field, value)`, `setLines(indexes, field, value)`, `clearScript()`,
 * `clearCharacter(group)`, `clearLines(indexes)`, `modeNumbers(group, values, id)`,
 * `autoLanguage(group, values)`, `takeFor(line, mode, speaker, values)`, `editPreset`,
 * `canSave(group)`, `saveButton(group)`, `openPresets()`, `openTuning(group)`.
 */
export function renderTunePanel(box, ctx) {
    const { script } = ctx;
    const group = script.focus?.character ? script.groups.find(item => item.group === script.focus.character) : null;
    let parts;
    if (script.picked.length) parts = renderLinesView(ctx, script.picked);
    else if (group) parts = renderCharacterView(ctx, group);
    else parts = renderScriptView(ctx);
    if (!ctx.canTag && (script.picked.length || group)) parts.splice(1, 0, el('div', 'anomalous-sd-run-hint is-warning', t('scriptTuneOldTts')));
    box.replaceChildren(...parts);
}
