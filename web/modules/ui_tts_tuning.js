import { t } from './interface_settings.js';
import { createViewScope } from './ui_lifecycle.js';
import { anomalousAlert } from './ui_dialog.js';
import { button, el } from './usage_view.js';
import { fetchGptSovitsCharacter, saveGptSovitsSettings } from './audio_engines.js';
import { LANGS, PARAM_RANGES, SAMPLING, generalPreset, lineTuning, loadPresets, mergeTuning, presetLabel, tuningRows } from './tts_presets_api.js';

/**
 * A character's generation settings (Anomalous_TTS interface 16): a preset and speed for
 * the character as a whole and for each language it speaks, numbers when a preset is not
 * enough. Empty = the general presets (GPT-SoVITS Settings). Each row shows the numbers its
 * lines get, marked where they differ from the general presets. Saving keeps every other
 * settings field, `defaults.language` included.
 */

let activeScope = null;

function numberInput(key, value, placeholder) {
    const [min, max, step] = PARAM_RANGES[key];
    const input = el('input', 'anomalous-tts-number');
    Object.assign(input, { type: 'number', min, max, step, placeholder: String(placeholder ?? '') });
    if (typeof value === 'number') input.value = value;
    return input;
}

/** The number in `input`, null when empty, or NaN when out of range. */
function readNumber(key, input) {
    if (input.value.trim() === '') return null;
    const [min, max] = PARAM_RANGES[key];
    const number = key === 'top_k' ? Math.round(Number(input.value)) : Number(input.value);
    return Number.isFinite(number) && number >= min && number <= max ? number : NaN;
}

/** Open the dialog for one GPT-SoVITS voice group; `onSaved(group)` after the node took it. */
export function openTuningEditor(group, { onSaved } = {}) {
    activeScope?.dispose();
    const scope = createViewScope();
    activeScope = scope;
    const name = group.raw?.name || group.character;
    let settings = group.raw?.settings && typeof group.raw.settings === 'object' ? group.raw.settings : {};
    const refLang = group.raw?.reference?.language || group.language || '';
    let view = null;

    const overlay = el('div', 'anomalous-voice-modal-overlay');
    const modal = el('div', 'anomalous-voice-modal anomalous-tts-editor anomalous-tts-tuning');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const close = () => scope.dispose();
    scope.onDispose(() => {
        overlay.remove();
        if (activeScope === scope) activeScope = null;
    });
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    scope.listen(window, 'keydown', (e) => {
        if (e.key !== 'Escape' || document.querySelector('.anomalous-dialog-overlay')) return;
        e.stopPropagation();
        close();
    }, true);

    const header = el('div', 'anomalous-voice-modal-header');
    const heading = el('div', 'anomalous-voice-modal-heading');
    heading.append(el('div', 'anomalous-voice-modal-title', t('ttsTuningTitle', { name })),
        el('div', 'anomalous-voice-modal-subtitle', t('ttsTuningSubtitle')));
    header.append(heading, button('anomalous-voice-modal-close', '×', close));

    const rowsBox = el('div', 'anomalous-tts-tuning-rows');
    let inputs = {};
    // The character's own language first: it is the row most people change.
    const order = ['all', ...[...LANGS].sort((a, b) => (b === refLang) - (a === refLang))];

    /** A row as typed so far; numbers out of range are left out until they are fixed. */
    const typedRow = ({ select, speed, fields }) => {
        const numbers = {};
        for (const param of SAMPLING) {
            const value = readNumber(param, fields[param]);
            if (typeof value === 'number' && !Number.isNaN(value)) numbers[param] = value;
        }
        const speedValue = readNumber('speed', speed);
        return { preset: select.value, numbers, speed: Number.isNaN(speedValue) ? null : speedValue };
    };

    // Each row's numbers in effect, marked where they differ from the general presets alone.
    const showEffect = () => {
        const rows = Object.fromEntries(Object.entries(inputs).map(([key, row]) => [key, typedRow(row)]));
        for (const [key, { effect }] of Object.entries(inputs)) {
            const { values, general } = lineTuning(view, rows, refLang, key);
            const items = [...SAMPLING, 'speed'].map(param => {
                const item = el('span', `anomalous-tts-tuning-value${values[param] !== general[param] ? ' is-diff' : ''}`,
                    `${param === 'speed' ? t('ttsTuningSpeed') : t(`scriptRunParamName_${param}`)} ${values[param]}`);
                if (values[param] !== general[param]) item.title = t('ttsTuningGeneralValue', { value: general[param] });
                return item;
            });
            const same = items.every(item => !item.classList.contains('is-diff'));
            effect.replaceChildren(el('span', 'anomalous-tts-setup-meta', t(same ? 'ttsTuningSameAsGeneral' : 'ttsTuningActual')), ...items);
        }
    };

    const draw = () => {
        const rows = tuningRows(settings);
        const names = Object.keys(view.presets);
        const label = name => presetLabel(view.labels, name, t);
        inputs = {};
        rowsBox.replaceChildren();
        for (const key of order) {
            const row = rows[key];
            const general = key === 'all' ? view.default : (key === refLang && view.presets[rows.all.preset] && rows.all.preset) || generalPreset(view, refLang, key);
            const line = el('div', 'anomalous-tts-tuning-row');
            const rowLabel = key === 'all' ? t('ttsTuningAll') : t('ttsTuningLang', { lang: t(`scriptRunLang_${key}`) });
            const select = el('select', 'anomalous-sd-run-select');
            const follow = el('option', '', t('ttsTuningFollow', { preset: label(general) }));
            follow.value = '';
            select.append(follow);
            for (const preset of names) {
                const option = el('option', '', label(preset));
                option.value = preset;
                select.append(option);
            }
            // A preset deleted since reads as "general", as the node treats it.
            select.value = names.includes(row.preset) ? row.preset : '';
            const speed = numberInput('speed', row.speed, '1.0');
            const numbers = el('details', 'anomalous-tts-tuning-numbers');
            numbers.append(el('summary', '', t('ttsTuningNumbers')));
            const grid = el('div', 'anomalous-tts-preset-grid');
            const shown = () => view.presets[select.value || general];
            const fields = {};
            for (const param of SAMPLING) {
                fields[param] = numberInput(param, row.numbers[param], shown()[param]);
                grid.append(el('span', 'anomalous-tts-setup-meta', t(`scriptRunParamName_${param}`)), fields[param]);
            }
            select.onchange = () => {
                for (const param of SAMPLING) fields[param].placeholder = String(shown()[param]);
                showEffect();
            };
            numbers.open = Object.keys(row.numbers).length > 0;
            numbers.append(grid, el('div', 'anomalous-tts-hint', t('ttsTuningNumbersHint')));
            const speedBox = el('label', 'anomalous-tts-tuning-speed');
            speedBox.append(el('span', 'anomalous-tts-setup-meta', t('ttsTuningSpeed')), speed);
            const effect = el('div', 'anomalous-tts-tuning-effect');
            line.append(el('span', 'anomalous-tts-tuning-label', rowLabel), select, speedBox, effect, numbers);
            line.addEventListener('input', showEffect);
            rowsBox.append(line);
            inputs[key] = { select, speed, fields, effect };
        }
        showEffect();
    };

    const footer = el('div', 'anomalous-voice-modal-footer');
    const saveBtn = button('anomalous-voice-modal-submit', t('ttsEditorSave'), async () => {
        const rows = {};
        for (const [key, { select, speed, fields }] of Object.entries(inputs)) {
            const numbers = {};
            for (const param of SAMPLING) {
                const value = readNumber(param, fields[param]);
                if (Number.isNaN(value)) return anomalousAlert(t('ttsTuningBadNumber', { name: t(`scriptRunParamName_${param}`) }));
                if (value !== null) numbers[param] = value;
            }
            const speedValue = readNumber('speed', speed);
            if (Number.isNaN(speedValue)) return anomalousAlert(t('ttsTuningBadNumber', { name: t('ttsTuningSpeed') }));
            rows[key] = { preset: select.value, numbers, speed: speedValue };
        }
        saveBtn.disabled = true;
        try {
            onSaved?.(await saveGptSovitsSettings(name, mergeTuning(settings, rows)));
            close();
        } catch (e) {
            if (!scope.signal.aborted) await anomalousAlert(t('ttsEditorSaveFailed', { error: e.message }));
        } finally {
            if (!scope.signal.aborted) saveBtn.disabled = false;
        }
    });
    saveBtn.disabled = true;
    footer.append(button('anomalous-voice-modal-cancel', t('dialogCancel'), close), saveBtn);

    // The summary may be up to a minute old: read the settings as they are now.
    const status = el('div', 'anomalous-tts-hint anomalous-tts-status', t('ttsEditorLoadingFiles'));
    Promise.all([fetchGptSovitsCharacter(name, scope.signal), loadPresets()]).then(([detail, presets]) => {
        if (scope.signal.aborted) return;
        if (detail.settings_error) throw new Error(detail.settings_error);
        if (detail.settings && typeof detail.settings === 'object') settings = detail.settings;
        view = presets;
        draw();
        status.hidden = true;
        saveBtn.disabled = false;
    }).catch(e => {
        if (scope.signal.aborted) return;
        status.textContent = t('ttsEditorLoadFailed', { error: e.message || String(e) });
        status.classList.add('is-error');
    });

    const body = el('div', 'anomalous-tts-editor-body');
    body.append(status, rowsBox);
    modal.append(header, body, footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    return close;
}
