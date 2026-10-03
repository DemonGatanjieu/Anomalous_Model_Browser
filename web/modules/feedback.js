/**
 * Feedback on GitHub: a bug report or a suggestion opens a new issue with the environment
 * already written in, and the same environment can be copied for other channels.
 * The environment is versions and hardware only (plugin, ComfyUI, Python, PyTorch, GPU,
 * browser, page, language): never a path, a file name or ComfyUI's command line.
 * Nothing is sent anywhere; the person reads it in the issue before posting.
 */

import { isTtsInstalled } from './audio_engines.js';

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

function openIssue(title, body) {
    const query = new URLSearchParams({ title, body });
    window.open(`${REPO}/issues/new?${query}`, '_blank', 'noopener');
}

/** A new issue for a problem, with headings to fill and the environment under them. */
export async function openBugReport(owner) {
    const environment = await collectDiagnostics(owner);
    openIssue('[Bug] ', [
        '### 发生了什么 / What happened', '', '',
        '### 怎么复现 / Steps to reproduce', '1. ', '2. ', '',
        '### 报错信息（可选）/ Error messages (optional)',
        '<!-- ComfyUI 命令行窗口里的红字，或浏览器按 F12 后 Console 里的报错 / The ComfyUI console or the browser console (F12) -->', '',
        '### 环境 / Environment', environment,
    ].join('\n'));
}

/** A new issue for an idea. */
export async function openSuggestion(owner) {
    const environment = await collectDiagnostics(owner);
    openIssue('[Idea] ', [
        '### 想要什么 / What you would like', '', '',
        '### 用在什么场合 / When you would use it', '', '',
        '### 环境 / Environment', environment,
    ].join('\n'));
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
