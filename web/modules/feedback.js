/**
 * Feedback on GitHub: what was written in the feedback window (ui_feedback_dialog.js)
 * opens as a new issue in the browser's language, with the environment folded at the end,
 * and the same environment can be copied for other channels.
 * The environment is versions and hardware only (plugin, ComfyUI, Python, PyTorch, GPU,
 * browser, page, language): never a path, a file name or ComfyUI's command line.
 * Nothing is sent anywhere; the person reads it in the issue before posting.
 */

import { isTtsInstalled } from './audio_engines.js';
import { translate } from './locales.js';

const t = (key, params) => translate(key, params);

const REPO = 'https://github.com/DemonGatanjieu/Anomalous_Model_Browser';

async function fetchJson(url) {
    try {
        const res = await fetch(url);
        return res.ok ? await res.json() : null;
    } catch {
        return null;
    }
}

/** "Chrome 141" / "Edge 140" / "Firefox 133" from the user agent, or the agent's last word. */
function browserName() {
    const agent = navigator.userAgent || '';
    for (const [name, pattern] of [['Edge', /Edg\/(\d+)/], ['Firefox', /Firefox\/(\d+)/], ['Chrome', /Chrome\/(\d+)/], ['Safari', /Version\/(\d+).*Safari/]]) {
        const match = pattern.exec(agent);
        if (match) return `${name} ${match[1]}`;
    }
    return agent.split(' ').pop() || 'unknown';
}

function gigabytes(bytes) {
    return bytes ? `${Math.round(bytes / 1024 ** 3)} GB` : '';
}

/** The environment as lines of "name: value", for an issue or a chat. */
export async function collectDiagnostics(owner) {
    const [version, stats, tts] = await Promise.all([
        fetchJson('/anomalous/version'), fetchJson('/system_stats'), isTtsInstalled().catch(() => false),
    ]);
    const state = version?.state || {};
    const system = stats?.system || {};
    const device = stats?.devices?.[0];
    // "cuda:0 NVIDIA GeForce RTX 4050 Laptop GPU : cudaMallocAsync" -> the card's name.
    const gpu = device ? String(device.name || '').replace(/^\S+:\d+\s+/, '').replace(/\s+:\s+\S+$/, '') : '';
    const plugin = [state.label || state.tag || state.commit || 'unknown', state.branch && state.branch !== 'main' ? `(${state.branch})` : '',
        state.dirty ? '(modified)' : ''].filter(Boolean).join(' ');
    const lines = [
        ['Anomalous Model Browser', plugin],
        ['ComfyUI', [system.comfyui_version, window.__COMFYUI_FRONTEND_VERSION__ && `frontend ${window.__COMFYUI_FRONTEND_VERSION__}`].filter(Boolean).join(' · ')],
        ['Python / PyTorch', [String(system.python_version || '').split(' ')[0], system.pytorch_version].filter(Boolean).join(' / ')],
        ['GPU', [gpu, gigabytes(device?.vram_total)].filter(Boolean).join(' · ')],
        ['RAM', gigabytes(system.ram_total)],
        ['OS / Browser', [system.os, browserName()].filter(Boolean).join(' / ')],
        ['Anomalous_TTS', tts ? 'installed' : 'not installed'],
        ['Page / language', [owner?.currentShellPage?.(), window.anomalous_browser_lang].filter(Boolean).join(' / ')],
    ];
    return lines.filter(([, value]) => value).map(([name, value]) => `- ${name}: ${value}`).join('\n');
}

/** "[Bug] the first words of what was written", short enough for a list of issues. */
function issueTitle(kind, text) {
    const first = String(text || '').trim().split('\n')[0].trim();
    const short = first.length > 60 ? `${first.slice(0, 59)}…` : first;
    return `${t(kind === 'bug' ? 'feedbackIssueBugPrefix' : 'feedbackIssueIdeaPrefix')}${short}`;
}

/**
 * Opens a new GitHub issue with what was written, in the browser's language; the
 * environment, when attached, is folded at the end so the issue reads as the person wrote it.
 */
export async function openIssue(owner, kind, text, { environment = true } = {}) {
    const parts = [String(text || '').trim()];
    if (environment) {
        parts.push('', `<details><summary>${t('feedbackIssueEnvironment')}</summary>`, '', await collectDiagnostics(owner), '', '</details>');
    }
    const query = new URLSearchParams({ title: issueTitle(kind, text), body: parts.join('\n') });
    window.open(`${REPO}/issues/new?${query}`, '_blank', 'noopener');
}

/** Copies the environment; true when it reached the clipboard. */
export async function copyDiagnostics(owner) {
    try {
        await navigator.clipboard.writeText(await collectDiagnostics(owner));
        return true;
    } catch {
        return false;
    }
}
