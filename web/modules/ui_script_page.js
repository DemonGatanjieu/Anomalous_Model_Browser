/**
 * The Voices page's Voice-over view (配音, shell page `script`, under the rail's Voices
 * entry like the character cards): the switch to Characters, then the script director.
 * It loads the GPT-SoVITS characters and mounts ui_script_director.js; without the node
 * pack it shows how to install it, without characters the way to import one. The
 * character list on the left chooses who speaks here; a character card's "Voice-over"
 * and the audio gallery's "voice it again" open it with a character (and lines) chosen
 * (`owner.openScript`).
 */

import { t } from './interface_settings.js';
import { isTtsInstalled, loadVoices } from './audio_engines.js';
import { parseTaggedSpeech, ttsOutputPrefix } from './audio_script.js';
import { loadScriptLines, mountScriptDirector, scriptCharacter, setScriptDirectorHooks, updateScriptDirectorVoices } from './ui_script_director.js';
import { renderInstallCard, stopAudioStudioPlayback } from './ui_audio_studio.js';
import { stopGalleryAudio } from './ui_audio_gallery.js';
import { setActiveAudioFilter, syncAudioSidebarSelection } from './ui_audio_sidebar.js';
import { renderVoiceTabs } from './ui_voice_tabs.js';

const renderTokens = new WeakMap();

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** A centred message instead of the director, with an optional button. */
function note(text, action = null) {
    const box = el('div', 'anomalous-script-page-note');
    box.append(el('p', '', text));
    if (action) {
        const btn = el('button', 'anomalous-sd-btn primary', action.label);
        btn.type = 'button';
        btn.onclick = action.onClick;
        box.append(btn);
    }
    return box;
}

/** The voice group whose output folder holds a generated file (`audio/<character>`), or null. */
function groupForFolder(groups, subfolder) {
    const folder = String(subfolder || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!folder) return null;
    return groups.find(group => {
        const prefix = ttsOutputPrefix(group.character);
        return prefix.slice(0, prefix.lastIndexOf('/')) === folder;
    })?.group || null;
}

/** The left list marks who speaks, as it marks the character shown on Characters. */
function markCharacter(owner, groups) {
    const group = groups.find(item => item.group === scriptCharacter());
    if (!group) return;
    setActiveAudioFilter({ type: 'group', value: group.group, character: group.character });
    syncAudioSidebarSelection(owner);
}

/**
 * Shows the view in `panel`. `character`: a voice group key to choose (a card, the list);
 * `script`: `{ speech, subfolder }` of a generated file to voice again.
 * Only the latest call for a panel may write to it.
 */
export async function renderScriptPage(panel, owner, { character = null, script = null } = {}) {
    const token = {};
    renderTokens.set(panel, token);
    setScriptDirectorHooks({
        owner,
        onPreviewStart: () => {
            stopAudioStudioPlayback();
            stopGalleryAudio();
        },
        onCharacterChange: () => loadVoices().then(result => markCharacter(owner, result.groups || [])),
        openGallery: () => owner.goTo('audio-gallery'),
    });
    if (!panel._scriptTop) {
        panel._scriptTop = el('div', 'anomalous-audio-toolbar anomalous-script-topbar');
        panel._scriptHost = el('div', 'anomalous-script-host');
        panel.replaceChildren(panel._scriptTop, panel._scriptHost);
    }
    panel._scriptTop.replaceChildren(renderVoiceTabs(owner, 'script'));
    const host = panel._scriptHost;
    const mounted = host.querySelector('.anomalous-script-director-panel');
    if (!mounted) host.replaceChildren(note(t('audioLoading')));

    const installed = await isTtsInstalled();
    if (renderTokens.get(panel) !== token) return;
    if (!installed) {
        host.replaceChildren(el('div', 'anomalous-script-page-note'));
        host.firstChild.append(renderInstallCard());
        return;
    }
    const result = await loadVoices();
    if (renderTokens.get(panel) !== token) return;
    if (result.error) {
        host.replaceChildren(note(t('audioLoadFailed', { error: result.error })));
        return;
    }
    const groups = result.groups || [];
    if (!groups.length) {
        host.replaceChildren(note(t('scriptPageNoCharacters'), { label: t('scriptPageGoVoices'), onClick: () => owner.goTo('voices') }));
        return;
    }
    const chosen = character || (script ? groupForFolder(groups, script.subfolder) : null);
    updateScriptDirectorVoices(groups, chosen, { choose: Boolean(chosen) });
    if (script?.speech) loadScriptLines(parseTaggedSpeech(script.speech));
    if (!mounted) host.replaceChildren();
    mountScriptDirector(host);
    markCharacter(owner, groups);
}
