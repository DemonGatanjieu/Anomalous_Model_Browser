/**
 * The Voices page's three views as one switch at the top of each: Characters (the cards,
 * ui_audio_studio.js, shell page `voices`), Voice-over (ui_script_page.js, shell page
 * `script`) and Audio (ui_audio_gallery.js, shell page `audio-gallery`). All sit under the
 * rail's Voices entry and share the list column.
 */

import { t } from './interface_settings.js';

const TABS = [['voices', 'voiceTabCharacters'], ['script', 'scriptDirectorTitle'], ['audio-gallery', 'shellAudioGallery']];

/** The switch; `active`: 'voices' | 'script' | 'audio-gallery'. */
export function renderVoiceTabs(owner, active) {
    const bar = document.createElement('div');
    bar.className = 'anomalous-voice-tabs';
    bar.setAttribute('role', 'tablist');
    for (const [page, key] of TABS) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'anomalous-voice-tab';
        tab.textContent = t(key);
        tab.dataset.tour = `voice-tab-${page}`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(page === active));
        tab.onclick = () => {
            if (page !== active) owner?.goTo(page);
        };
        bar.append(tab);
    }
    return bar;
}
