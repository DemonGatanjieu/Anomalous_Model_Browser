import { t } from './interface_settings.js';
import { createViewScope } from './ui_lifecycle.js';
import { anomalousAlert, anomalousConfirm, anomalousPrompt } from './ui_dialog.js';
import { fetchGptSovitsDetail, fetchReferenceClips, saveGptSovitsSettings, ttsAudioUrl } from './audio_engines.js';
import {
    AUX_FORMAT, AUX_VERSIONS, LINE_LIMIT, MAIN, clearMain, fitsMain, listClips, nameProblem, readVoices, roleOf,
    setMain, toggleAux, usesOf, voiceCount, voicesProblem, writeSettings,
} from './tts_voice_refs.js';

/**
 * GPT-SoVITS (Anomalous_TTS) reference audio editor, opened from a character card: the voices
 * on top (the main voice and each emotion, "+ New emotion"), and below every clip of the
 * character, one row each (listen, file and length, its line, where else it is used), where the
 * voice picked gets its **main reference** (its tone; one, with a line, 3~10 s) and its
 * **auxiliary references** (their timbre is averaged in; any number, no line needed). A clip's
 * line can be fixed right in its row. The rules are in tts_voice_refs.js; the node owns the
 * file, this window only sends the new settings through its API, keeping every field it does
 * not edit. Auxiliary references and fixed lines need Anomalous_TTS interface 18 (and
 * auxiliary references a v1 / v2 / v2Pro model); otherwise those controls are off and say why.
 *
 * The window opens at once and reads the character's clips, their lines and lengths in the
 * background (a folder can hold a thousand clips: the list shows the first ones, then more).
 */

const SHOWN_FIRST = 60;
const SHOW_MORE = 120;
const FILTERS = ['all', 'here', 'used', 'noline'];

let activeScope = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function button(className, label, onClick, title) {
    const btn = el('button', className, label);
    btn.type = 'button';
    if (title) { btn.title = title; btn.setAttribute('aria-label', title); }
    btn.onclick = onClick;
    return btn;
}

const say = ({ key, values }) => t(key, values);
const voiceLabel = voice => (voice.name === MAIN ? t('ttsRefsMainVoice') : voice.name);
const baseName = path => path.split('/').pop();
const folderOf = path => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/**
 * Open the editor for one GPT-SoVITS voice group (audio_engines.gptSovitsGroups shape).
 * `onSaved(group)` receives the refreshed group after the node accepted the settings.
 */
export function openGptSovitsEditor(group, { onSaved } = {}) {
    activeScope?.dispose();
    const scope = createViewScope();
    activeScope = scope;
    const raw = group.raw || {};
    const name = raw.name || group.character;

    const state = {
        loaded: false,
        format: 0,
        version: raw.version || null,
        settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : {},
        audio: [],
        found: new Map(),      // path -> the line the node finds (a fixed one first)
        seconds: new Map(),    // path -> length (interface 18)
        voices: [],
        fixes: new Map(),      // path -> the line fixed here
        cleared: new Set(),    // fixed lines taken back here (the file's line comes back once saved)
        voiceKey: 'main',
        filter: 'all',
        query: '',
        shown: SHOWN_FIRST,
        dirty: false,
        playing: null,         // { path, button }
    };
    let player = null;

    const overlay = el('div', 'anomalous-voice-modal-overlay');
    const modal = el('div', 'anomalous-voice-modal anomalous-tts-refs');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    scope.onDispose(() => {
        player?.pause();
        overlay.remove();
        if (activeScope === scope) activeScope = null;
    });
    const close = async () => {
        if (state.dirty && !await anomalousConfirm(t('ttsRefsCloseUnsaved'))) return;
        scope.dispose();
    };
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    scope.listen(window, 'keydown', (e) => {
        if (e.key !== 'Escape' || document.querySelector('.anomalous-dialog-overlay')) return;
        e.stopPropagation();
        close();
    }, true);

    const voice = () => state.voices.find(item => item.key === state.voiceKey) || state.voices[0];
    const lineOf = path => (state.fixes.has(path) ? state.fixes.get(path) : state.cleared.has(path) ? '' : state.found.get(path) || '');
    const canAux = () => state.format >= AUX_FORMAT && (!state.version || AUX_VERSIONS.has(state.version));
    const canFix = () => state.format >= AUX_FORMAT;
    const changed = () => {
        state.dirty = true;
        saveBtn.disabled = !state.loaded;
    };

    // ---------- listening ----------

    function stopPlaying() {
        player?.pause();
        player = null;
        if (state.playing) state.playing.button.classList.remove('is-playing');
        state.playing = null;
    }

    function play(path, btn) {
        const again = state.playing?.path === path;
        stopPlaying();
        if (again) return;
        player = new Audio(ttsAudioUrl(name, path));
        state.playing = { path, button: btn };
        btn.classList.add('is-playing');
        const done = () => { if (state.playing?.path === path) stopPlaying(); };
        player.onended = done;
        player.onerror = done;
        player.play().catch(done);
    }

    // ---------- header ----------

    const header = el('div', 'anomalous-voice-modal-header');
    const heading = el('div', 'anomalous-voice-modal-heading');
    heading.append(
        el('div', 'anomalous-voice-modal-title', t('ttsRefsTitle', { name })),
        el('div', 'anomalous-voice-modal-subtitle', t('ttsRefsSubtitle')),
    );
    header.append(heading, button('anomalous-voice-modal-close', '×', close, t('close')));

    const status = el('div', 'anomalous-tts-hint anomalous-tts-status', t('ttsEditorLoadingFiles'));

    // ---------- the voices ----------

    const voicesBar = el('div', 'anomalous-tts-refs-voices');
    const voiceTools = el('div', 'anomalous-tts-refs-voice-tools');

    function renderVoices() {
        const tabs = state.voices.map((item) => {
            const tab = button(`anomalous-tts-refs-voice${item.key === state.voiceKey ? ' is-current' : ''}`, '', () => {
                state.voiceKey = item.key;
                state.shown = SHOWN_FIRST;
                renderAll();
            });
            tab.append(el('span', 'anomalous-tts-refs-voice-name', voiceLabel(item)), el('span', 'anomalous-tts-refs-voice-count', say(item.name !== MAIN && !item.main ? { key: 'ttsRefsCountNone' } : voiceCount(item))));
            if (item.name !== MAIN && !item.main) tab.classList.add('is-missing');
            return tab;
        });
        tabs.push(button('anomalous-tts-refs-voice is-new', `＋ ${t('ttsRefsNewEmotion')}`, addEmotion));
        voicesBar.replaceChildren(...tabs);

        const current = voice();
        const tools = [];
        if (current?.name === MAIN) {
            tools.push(el('span', '', current.main ? t('ttsRefsMainHint') : t('ttsRefsMainAuto', { file: raw.reference?.audio ? baseName(raw.reference.audio) : '—' })));
            if (current.main) tools.push(button('anomalous-sd-link-btn', t('ttsRefsBackToAuto'), () => { clearMain(current); changed(); renderAll(); }));
        } else if (current) {
            tools.push(el('span', '', current.filename ? t('ttsRefsFromFilename') : t('ttsRefsEmotionHint', { name: current.name })));
            if (!current.filename) {
                tools.push(
                    button('anomalous-sd-link-btn', t('ttsRefsRename'), () => renameEmotion(current)),
                    button('anomalous-sd-link-btn is-danger', t('ttsRefsDelete'), () => deleteEmotion(current)),
                );
            }
        }
        voiceTools.replaceChildren(...tools);
    }

    async function addEmotion() {
        const value = await anomalousPrompt(t('ttsRefsNewEmotionPrompt'), '', t('ttsRefsNewEmotion'));
        if (value === null || value === undefined) return;
        const problem = nameProblem(value, state.voices);
        if (problem) return anomalousAlert(t(problem, { name: String(value).trim(), file: '' }));
        const item = { key: `e:${value.trim()}:${Date.now()}`, name: value.trim(), main: null, aux: [], kept: {}, filename: false, touched: true };
        state.voices.push(item);
        state.voiceKey = item.key;
        state.filter = 'all';
        changed();
        renderAll();
    }

    async function renameEmotion(item) {
        const value = await anomalousPrompt(t('ttsRefsRenamePrompt'), item.name, t('ttsRefsRename'));
        if (value === null || value === undefined || value.trim() === item.name) return;
        const problem = nameProblem(value, state.voices, item);
        if (problem) return anomalousAlert(t(problem, { name: String(value).trim(), file: '' }));
        item.name = value.trim();
        changed();
        renderAll();
    }

    async function deleteEmotion(item) {
        if (!await anomalousConfirm(t('ttsRefsDeleteConfirm', { name: item.name }))) return;
        state.voices = state.voices.filter(other => other !== item);
        state.voiceKey = 'main';
        changed();
        renderAll();
    }

    // ---------- the clips ----------

    const toolbar = el('div', 'anomalous-tts-refs-toolbar');
    const filters = el('div', 'anomalous-tts-refs-filters');
    const search = el('input', 'anomalous-tts-refs-search');
    search.type = 'search';
    search.placeholder = t('ttsRefsSearch');
    search.addEventListener('input', () => {
        state.query = search.value;
        state.shown = SHOWN_FIRST;
        renderList();
    });
    toolbar.append(filters, search);
    const list = el('div', 'anomalous-tts-refs-list');
    const note = el('div', 'anomalous-tts-hint anomalous-tts-refs-note');

    function renderFilters() {
        const current = voice();
        const count = {
            all: state.audio.length,
            here: current ? [current.main, ...current.aux].filter(Boolean).length : 0,
            used: state.audio.filter(path => state.voices.some(item => roleOf(item, path))).length,
            noline: state.audio.filter(path => !lineOf(path)).length,
        };
        filters.replaceChildren(...FILTERS.map(id => button(
            `anomalous-tts-refs-filter${state.filter === id ? ' is-on' : ''}`,
            t(`ttsRefsFilter_${id}`, { count: count[id] }),
            () => { state.filter = id; state.shown = SHOWN_FIRST; renderList(); renderFilters(); },
        )));
    }

    function lineBox(path) {
        const input = el('input', 'anomalous-tts-refs-line');
        input.type = 'text';
        input.maxLength = LINE_LIMIT;
        input.value = lineOf(path);
        input.placeholder = state.cleared.has(path) ? t('ttsRefsLineBack') : t('ttsRefsNoLine');
        input.disabled = !canFix();
        if (!canFix()) input.title = t('ttsRefsNeedsUpdate');
        input.classList.toggle('is-fixed', state.fixes.has(path));
        input.addEventListener('change', () => {
            const text = input.value.trim();
            if (!text) {
                if (state.fixes.delete(path)) state.cleared.add(path);
            } else if (text !== lineOf(path)) {
                state.fixes.set(path, text);
                state.cleared.delete(path);
            } else {
                return;
            }
            changed();
            renderRow(path);
            renderFilters();
        });
        return input;
    }

    const rows = new Map();

    function rowFor(path) {
        const current = voice();
        const role = roleOf(current, path);
        const seconds = state.seconds.get(path) || 0;
        const row = el('div', `anomalous-tts-refs-row${role ? ` is-${role}` : ''}`);
        const playBtn = button('anomalous-audio-play-btn', '▶', () => play(path, playBtn), t('audioPlay'));
        if (state.playing?.path === path) {
            playBtn.classList.add('is-playing');
            state.playing.button = playBtn;
        }
        const file = el('div', 'anomalous-tts-refs-file');
        const nameLine = el('div', 'anomalous-tts-refs-file-name', baseName(path));
        nameLine.title = path;
        if (seconds) {
            const length = el('span', `anomalous-tts-refs-seconds${fitsMain(seconds) ? '' : ' is-off'}`, t('ttsRefsSeconds', { seconds: seconds.toFixed(1) }));
            if (!fitsMain(seconds)) length.title = t('ttsRefsTooLongShort');
            nameLine.append(length);
        }
        file.append(nameLine);
        if (folderOf(path)) file.append(el('div', 'anomalous-tts-refs-file-folder', folderOf(path)));

        const middle = el('div', 'anomalous-tts-refs-middle');
        middle.append(lineBox(path));
        const uses = usesOf(state.voices, path, current);
        if (current?.name === MAIN && !current.main && raw.reference?.audio === path) uses.unshift({ name: MAIN, role: 'auto' });
        if (uses.length) {
            const tags = el('div', 'anomalous-tts-refs-uses');
            tags.append(...uses.map(use => el('span', `anomalous-tts-refs-use is-${use.role}`, t(`ttsRefsUse_${use.role}`, { name: use.name === MAIN ? t('ttsRefsMainVoice') : use.name }))));
            middle.append(tags);
        }

        const roles = el('div', 'anomalous-tts-refs-roles');
        const mainBtn = button(`anomalous-tts-refs-role${role === 'main' ? ' is-on' : ''}`, role === 'main' ? `◉ ${t('ttsRefsMain')}` : `○ ${t('ttsRefsMain')}`, () => {
            if (role === 'main') {
                if (current.name !== MAIN) return;
                clearMain(current);
            } else {
                setMain(current, path);
            }
            changed();
            renderAll(false);
        }, role === 'main' && current?.name === MAIN ? t('ttsRefsMainOffHint') : t('ttsRefsMainHintRow'));
        mainBtn.disabled = !current || (!fitsMain(seconds) && role !== 'main');
        if (!fitsMain(seconds) && role !== 'main') mainBtn.title = t('ttsRefsTooLongShort');
        const auxBtn = button(`anomalous-tts-refs-role is-aux${role === 'aux' ? ' is-on' : ''}`, role === 'aux' ? `☑ ${t('ttsRefsAux')}` : `☐ ${t('ttsRefsAux')}`, () => {
            toggleAux(current, path);
            changed();
            renderAll(false);
        }, t('ttsRefsAuxHintRow'));
        auxBtn.disabled = !current || !canAux() || role === 'main';
        if (!canAux()) auxBtn.title = auxReason();
        roles.append(mainBtn, auxBtn);
        row.append(playBtn, file, middle, roles);
        return row;
    }

    function renderRow(path) {
        const old = rows.get(path);
        if (!old) return;
        const next = rowFor(path);
        old.replaceWith(next);
        rows.set(path, next);
    }

    // The order is set when the voice, the filter or the search changes, not on each click,
    // so a row does not move away under the pointer.
    let order = [];

    function renderList(reorder = true) {
        if (!state.loaded) return;
        if (reorder) order = listClips(state.audio, { voice: voice(), voices: state.voices, lineOf, filter: state.filter, query: state.query });
        rows.clear();
        const shown = order.slice(0, state.shown);
        const items = shown.map((path) => {
            const row = rowFor(path);
            rows.set(path, row);
            return row;
        });
        if (!order.length) items.push(el('div', 'anomalous-tts-refs-empty', t('ttsRefsNothing')));
        if (order.length > shown.length) {
            items.push(button('anomalous-tts-refs-more', t('ttsRefsShowMore', { count: order.length - shown.length }), () => {
                state.shown += SHOW_MORE;
                renderList(false);
            }));
        }
        list.replaceChildren(...items);
    }

    function auxReason() {
        if (state.format < AUX_FORMAT) return t('ttsRefsNeedsUpdate');
        return t('ttsRefsAuxVersion', { version: state.version });
    }

    function renderNote() {
        const parts = [t('ttsRefsNote')];
        if (!canAux()) parts.push(auxReason());
        note.textContent = parts.join(' ');
    }

    function renderAll(reorder = true) {
        renderVoices();
        renderFilters();
        renderList(reorder);
        renderNote();
    }

    // ---------- saving ----------

    const footer = el('div', 'anomalous-voice-modal-footer');
    const saveBtn = button('anomalous-voice-modal-submit', t('ttsEditorSave'), async () => {
        if (!state.loaded) return;
        const problem = voicesProblem(state.voices, state.audio);
        if (problem) {
            const missing = state.voices.find(item => item.name === problem.values?.name && !item.main);
            if (missing) {
                state.voiceKey = missing.key;
                renderAll();
            }
            await anomalousAlert(say(problem));
            return;
        }
        const next = writeSettings(state.settings, state.voices, state.fixes, { aux: state.format >= AUX_FORMAT, lines: canFix() });
        saveBtn.disabled = true;
        try {
            const updated = await saveGptSovitsSettings(name, next);
            state.dirty = false;
            onSaved?.(updated);
            scope.dispose();
        } catch (e) {
            if (!scope.signal.aborted) await anomalousAlert(t('ttsEditorSaveFailed', { error: e.message }));
        } finally {
            if (!scope.signal.aborted) saveBtn.disabled = !state.loaded;
        }
    });
    saveBtn.disabled = true;
    footer.append(note, button('anomalous-voice-modal-cancel', t('dialogCancel'), close), saveBtn);

    Promise.all([
        fetchGptSovitsDetail(name, scope.signal),
        fetchReferenceClips(name, scope.signal).catch(() => null), // the lines only help: never block the files
    ]).then(([{ character, format }, clips]) => {
        if (scope.signal.aborted) return;
        state.format = format;
        state.version = character.version || state.version;
        state.audio = Array.isArray(character.audio) ? character.audio : [];
        // The detail is read from disk now: keep its unknown fields when saving.
        if (character.settings && typeof character.settings === 'object') state.settings = character.settings;
        state.found = clips?.lines || new Map();
        state.seconds = clips?.seconds || new Map();
        ({ voices: state.voices, fixes: state.fixes } = readVoices(state.settings, character, { lineFixes: canFix(), found: state.found }));
        status.textContent = t('ttsEditorFileCount', { count: state.audio.length });
        state.loaded = true;
        saveBtn.disabled = false;
        renderAll();
    }).catch(e => {
        if (scope.signal.aborted) return;
        status.textContent = t('ttsEditorLoadFailed', { error: e.message || String(e) });
        status.classList.add('is-error');
    });

    const top = el('div', 'anomalous-tts-refs-top');
    top.append(status, voicesBar, voiceTools, toolbar);
    modal.append(header, top, list, footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    search.focus();
    return () => scope.dispose();
}
