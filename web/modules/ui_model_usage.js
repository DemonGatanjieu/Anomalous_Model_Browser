/**
 * The Tidy tab's "Not used lately" part: the models by when they were last used (usage_view.js
 * runs the check). Models picked here go to the Recycle Bin (model_placement.js). Node packs are
 * in Settings → Node packs (ui_pack_usage.js); a line here leads there.
 */

import { translate as t } from './locales.js';
import { recycleModel } from './model_placement.js';
import { formatSize } from './ui_model_download.js';
import { openSettingsPage } from './ui_settings_page.js';
import { button, el, lastUsed, notUsedSince, usageSection } from './usage_view.js';

const SHOWN = 100; // rows drawn at most; the rest is counted

const keyOf = (item) => `${item.type}|${item.root}|${item.rel}`;

function cover(item) {
    const box = el('div', 'anomalous-tidy-cover is-small');
    if (item.preview_url) {
        const image = el('img');
        image.loading = 'lazy';
        image.alt = '';
        image.src = `${item.preview_url}&variant=${/\.(mp4|webm|mov|avi)(&|$)/i.test(item.preview_url) ? 'poster' : 'card'}`;
        box.append(image);
    } else {
        box.append(el('span', 'anomalous-tidy-cover-none', t('noPreview')));
    }
    return box;
}

function modelRow(view, item, now, redrawFoot) {
    const row = el('label', 'anomalous-usage-row');
    const pick = el('input');
    pick.type = 'checkbox';
    pick.checked = view.picked.has(keyOf(item));
    pick.onchange = () => {
        if (pick.checked) view.picked.add(keyOf(item));
        else view.picked.delete(keyOf(item));
        redrawFoot();
    };
    const body = el('div', 'anomalous-usage-body');
    const name = el('div', 'anomalous-tidy-name');
    name.append(el('strong', '', item.name));
    if (item.version) name.append(el('span', 'anomalous-card-version anomalous-tidy-version', item.version));
    body.append(name, el('div', 'anomalous-tidy-file', `${item.type} / ${item.rel} · ${formatSize(item.size)}`),
        el('div', 'anomalous-usage-when', lastUsed(item, now)));
    if (item.saved) body.append(el('div', 'anomalous-usage-saved', t('tidyUsageSaved', { count: item.saved })));
    row.append(pick, cover(item), body);
    return row;
}

function modelList(section, view, onRecycled) {
    const { models, now } = view.data;
    const listed = models.filter(item => notUsedSince(item, view.filter, now)).sort((a, b) => b.size - a.size);
    const foot = el('div', 'anomalous-usage-foot');
    const recycle = button('anomalous-scan-primary anomalous-scan-small-btn', t('tidyUsageRecycle'), async () => {
        const picked = listed.filter(item => view.picked.has(keyOf(item)));
        const size = picked.reduce((sum, item) => sum + item.size, 0);
        if (!picked.length || !confirm(t('tidyUsageConfirm', { count: picked.length, size: formatSize(size) }))) return;
        recycle.disabled = true;
        const gone = [];
        try {
            for (const item of picked) {
                await recycleModel(item);
                gone.push(keyOf(item));
            }
        } catch (error) {
            console.warn('[AMB] Tidy: could not recycle a model.', error);
            alert(t('tidyUsageRecycleFailed'));
        }
        view.data.models = models.filter(item => !gone.includes(keyOf(item)));
        view.picked.clear();
        onRecycled(t('tidyUsageRecycled', { count: gone.length, size: formatSize(picked.filter(item => gone.includes(keyOf(item))).reduce((sum, item) => sum + item.size, 0)) }));
    });
    const summary = el('span', 'anomalous-download-note');
    const drawFoot = () => {
        const picked = listed.filter(item => view.picked.has(keyOf(item)));
        summary.textContent = picked.length
            ? t('tidyUsagePicked', { count: picked.length, size: formatSize(picked.reduce((sum, item) => sum + item.size, 0)) })
            : t('tidyUsagePickHint');
        recycle.disabled = !picked.length;
    };
    drawFoot();
    foot.append(summary, recycle);

    if (!listed.length) section.append(el('div', 'anomalous-tidy-done', t('tidyUsageNone')));
    else {
        section.append(...listed.slice(0, SHOWN).map(item => modelRow(view, item, now, drawFoot)));
        if (listed.length > SHOWN) {
            const rest = listed.slice(SHOWN);
            section.append(el('div', 'anomalous-tidy-file', t('tidyUsageMore', { count: rest.length, size: formatSize(rest.reduce((sum, item) => sum + item.size, 0)) })));
        }
        section.append(foot);
    }
}

/** The part under the Tidy tab's checks; `onRecycled(note)` after models went to the Recycle Bin. */
export function renderUsageSection(owner, onRecycled) {
    return usageSection(owner, {
        titleKey: 'tidyUsageTitle', leadKey: 'tidyUsageLead', redraw: () => owner.loadModels(),
        aside: button('anomalous-usage-elsewhere', t('tidyUsagePacksElsewhere'), () => openSettingsPage(owner, { tab: 'packs' })),
        body: (section, view) => modelList(section, view, onRecycled),
    });
}
