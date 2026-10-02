/**
 * The Voices page's two views as one switch at the top of each: Characters (the cards,
 * ui_audio_studio.js, shell page `voices`) and Voice-over (ui_script_page.js, shell page
 * `script`). Both sit under the rail's Voices entry and share the character list.
 */

import { t } from './interface_settings.js';

const TABS = [['voices', 'voiceTabCharacters'], ['script', 'scriptDirectorTitle']];

/** The switch; `active`: 'voices' | 'script'. */
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
