/**
 * The Voice-over page (配音, rail page `script`): the script director as a page of its
 * own, between Voices (preparing characters) and Audio (the results). It loads the
 * GPT-SoVITS characters and mounts ui_script_director.js; without the node pack it shows
 * how to install it, without characters the way to Voices. A character card's
 * "Voice-over" opens it with that character chosen (`owner.openScript(group)`).
 */

import { t } from './interface_settings.js';
import { isTtsInstalled, loadVoices } from './audio_engines.js';
import { mountScriptDirector, setScriptDirectorHooks, updateScriptDirectorVoices } from './ui_script_director.js';
import { renderInstallCard, stopAudioStudioPlayback } from './ui_audio_studio.js';
import { stopGalleryAudio } from './ui_audio_gallery.js';

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

/**
 * Shows the page in `panel`. `character`: a voice group key to choose (from a card).
 * Only the latest call for a panel may write to it.
 */
export async function renderScriptPage(panel, owner, { character = null } = {}) {
    const token = {};
    renderTokens.set(panel, token);
    setScriptDirectorHooks({
        owner,
        onPreviewStart: () => {
            stopAudioStudioPlayback();
            stopGalleryAudio();
        },
    });
    const mounted = panel.querySelector('.anomalous-script-director-panel');
    if (!mounted) panel.replaceChildren(note(t('audioLoading')));

    const installed = await isTtsInstalled();
    if (renderTokens.get(panel) !== token) return;
    if (!installed) {
        panel.replaceChildren(el('div', 'anomalous-script-page-note', ''));
        panel.firstChild.append(renderInstallCard());
        return;
    }
    const result = await loadVoices();
    if (renderTokens.get(panel) !== token) return;
    if (result.error) {
        panel.replaceChildren(note(t('audioLoadFailed', { error: result.error })));
        return;
    }
    const groups = result.groups || [];
    if (!groups.length) {
        panel.replaceChildren(note(t('scriptPageNoCharacters'), { label: t('scriptPageGoVoices'), onClick: () => owner.goTo('voices') }));
        return;
    }
    updateScriptDirectorVoices(groups, character, { choose: Boolean(character) });
    if (!mounted) panel.replaceChildren();
    mountScriptDirector(panel);
}
