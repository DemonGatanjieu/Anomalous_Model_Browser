import { app } from '../../../scripts/app.js';
import { normalizeLocale, resolveLocale, translate } from './locales.js';

export const LANGUAGE_SETTING_ID = 'Anomalous.ModelBrowser.Language';
export const THEME_SETTING_ID = 'Anomalous.ModelBrowser.Theme';

let defaultLang = 'zh';
try {
    let comfyDetected = false;
    const aglLang = localStorage.getItem('Comfy.Settings.AIGODLIKE-COMFYUI-TRANSLATION.Language');
    if (aglLang) {
        defaultLang = aglLang.toLowerCase().includes('en') ? 'en' : 'zh';
        comfyDetected = true;
    } else {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || (!key.toLowerCase().includes('lang') && !key.toLowerCase().includes('locale'))) continue;
            const value = localStorage.getItem(key);
            if (typeof value !== 'string') continue;
            const normalizedValue = value.toLowerCase();
            if (normalizedValue.includes('zh') || normalizedValue.includes('chinese')) {
                defaultLang = 'zh';
                comfyDetected = true;
                break;
            }
            if (normalizedValue.includes('en') || normalizedValue.includes('english')) {
                defaultLang = 'en';
                comfyDetected = true;
                break;
            }
        }
    }

    if (!comfyDetected && navigator.language && !navigator.language.toLowerCase().startsWith('zh')) {
        defaultLang = 'en';
    }
} catch (_) {
    if (navigator.language && !navigator.language.toLowerCase().startsWith('zh')) {
        defaultLang = 'en';
    }
}

let currentLang = resolveLocale(localStorage.getItem('anomalous_lang') || defaultLang);
window.anomalous_browser_lang = currentLang;

export const t = (key, params) => translate(key, params, window.anomalous_browser_lang || currentLang);
export const getCurrentLanguage = () => currentLang;

function normalizeLanguagePreference(value) {
    return value === 'zh' || value === 'en' ? value : 'auto';
}

function resolveComfyLanguage() {
    try {
        const settings = app.extensionManager?.setting;
        const locale = settings?.get('Comfy.Locale')
            || app.ui?.settings?.getSettingValue?.('Comfy.Locale')
            || app.ui?.settings?.getSettingValue?.('Comfy.Locale.Language');
        return normalizeLocale(locale) || defaultLang;
    } catch (_) {
        return defaultLang;
    }
}

function getSettingTranslationPatches() {
    const category = t('mainInterfaceCategory');
    return {
        [LANGUAGE_SETTING_ID]: {
            name: t('mainLanguageSetting'),
            category: ['Anomalous Model Browser', category, 'language'],
            tooltip: t('mainLanguageTooltip'),
            options: [
                { value: 'auto', text: t('mainLanguageAuto') },
                { value: 'zh', text: t('mainLanguageChinese') },
                { value: 'en', text: t('mainLanguageEnglish') }
            ]
        },
        [THEME_SETTING_ID]: {
            name: t('settingsTheme'),
            category: ['Anomalous Model Browser', category, 'theme'],
            tooltip: t('settingsThemeHelp'),
            options: THEMES.map(value => ({ value, text: t(THEME_LABELS[value]) }))
        }
    };
}

function refreshRegisteredSettings() {
    const settingsApi = app.extensionManager?.setting;
    const registry = settingsApi?.settings?.value || settingsApi?.settings;
    if (!registry || typeof registry !== 'object') return;
    for (const [id, patch] of Object.entries(getSettingTranslationPatches())) {
        if (registry[id]) registry[id] = { ...registry[id], ...patch };
    }
}

/** 'auto' | 'zh' | 'en': the ComfyUI setting's change handler, also used without the settings API. */
export function applyLanguagePreference(value) {
    const preference = normalizeLanguagePreference(value);
    if (preference === 'auto') localStorage.removeItem('anomalous_lang');
    else localStorage.setItem('anomalous_lang', preference);

    const nextLanguage = preference === 'auto' ? resolveComfyLanguage() : preference;
    const changed = nextLanguage !== window.anomalous_browser_lang;
    currentLang = nextLanguage;
    window.anomalous_browser_lang = nextLanguage;
    refreshRegisteredSettings();
    if (changed) {
        window.dispatchEvent(new CustomEvent('anomalous-language-change', {
            detail: { language: nextLanguage, preference }
        }));
    }
}

/**
 * "Follow ComfyUI" (no language chosen here): takes up a ComfyUI language changed since the
 * page loaded. Called when the browser opens, since ComfyUI switches its language without a reload.
 */
export function followComfyLanguage() {
    if (!localStorage.getItem('anomalous_lang')) applyLanguagePreference('auto');
}

if (!localStorage.getItem('anomalous_lang')) {
    currentLang = resolveComfyLanguage();
    window.anomalous_browser_lang = currentLang;
}

function showThemeNoticeToast(isEnabled) {
    document.getElementById('anomalous-theme-toast')?.remove();
    const toast = document.createElement('div');
    toast.id = 'anomalous-theme-toast';
    toast.className = 'anomalous-theme-toast' + (isEnabled ? ' is-abyssal' : '');
    toast.textContent = isEnabled ? t('themeDomainActivated') : t('themeDomainDeactivated');
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-show'));
    setTimeout(() => {
        toast.classList.remove('is-show');
        setTimeout(() => toast.remove(), 400);
    }, 2400);
}

/*
 * The theme: 'auto' follows ComfyUI's palette (ComfyUI marks a dark one with `dark-theme` on
 * <html>, a light one without), 'dark', 'light', or 'abyssal' (Abyssal Scarlet, a dark palette).
 * Shown through classes on <html>: `amb-theme-light` and `theme-abyssal-scarlet`; the colors are
 * the --amb-* tokens of 00-foundation-models.css.
 */
const THEME_KEY = 'anomalous_theme';
const THEMES = ['auto', 'dark', 'light', 'abyssal'];
const THEME_LABELS = { auto: 'settingsThemeAuto', dark: 'settingsThemeDark', light: 'settingsThemeLight', abyssal: 'settingsThemeAbyssal' };

/** The theme chosen ('auto' unless one was picked; an older Abyssal Scarlet switch reads as 'abyssal'). */
export function themePreference() {
    try {
        const saved = localStorage.getItem(THEME_KEY);
        if (THEMES.includes(saved)) return saved;
        return localStorage.getItem('anomalous_theme_abyssal_scarlet') === 'true' ? 'abyssal' : 'auto';
    } catch (_) {
        return 'auto';
    }
}

/** What is shown: 'dark', 'light' or 'abyssal'. */
export function effectiveTheme(preference = themePreference()) {
    if (preference !== 'auto') return preference;
    return document.documentElement.classList.contains('dark-theme') ? 'dark' : 'light';
}

let shownTheme = null;

function paintTheme() {
    const theme = effectiveTheme();
    const abyssal = theme === 'abyssal';
    document.documentElement.classList.toggle('theme-abyssal-scarlet', abyssal);
    document.documentElement.classList.toggle('amb-theme-light', theme === 'light');
    document.getElementById('anomalous-modal')?.classList.toggle('theme-abyssal-scarlet', abyssal);
    document.getElementById('anomalous-container')?.classList.toggle('theme-abyssal-scarlet', abyssal);
    if (theme === shownTheme) return;
    shownTheme = theme;
    window.dispatchEvent(new CustomEvent('anomalous-theme-change', {
        detail: { theme: abyssal ? 'abyssal-scarlet' : theme, enabled: abyssal }
    }));
}

/** Picks the theme (Settings, ComfyUI's settings); `notify`: the toast when Abyssal Scarlet comes or goes. */
export function setThemePreference(value, notify = false) {
    const preference = THEMES.includes(value) ? value : 'auto';
    const wasAbyssal = effectiveTheme() === 'abyssal';
    try {
        localStorage.setItem(THEME_KEY, preference);
        localStorage.removeItem('anomalous_theme_abyssal_scarlet');
    } catch (_) {}
    paintTheme();
    try {
        const settings = app.extensionManager?.setting;
        if (settings && typeof settings.set === 'function' && settings.get(THEME_SETTING_ID) !== preference) {
            settings.set(THEME_SETTING_ID, preference);
        }
    } catch (_) {}
    const isAbyssal = preference === 'abyssal';
    if (notify && isAbyssal !== wasAbyssal) showThemeNoticeToast(isAbyssal);
}

/** The logo's easter egg: Abyssal Scarlet on, or back to following ComfyUI. */
export function setAbyssalScarletTheme(enabled, notify = false) {
    setThemePreference(enabled ? 'abyssal' : 'auto', notify);
}

window.setAbyssalScarletTheme = setAbyssalScarletTheme;
paintTheme();
// Following ComfyUI: its palette switch changes <html>'s classes (ours are toggled only when they
// differ, so painting causes no further change).
new MutationObserver(() => {
    if (themePreference() === 'auto') paintTheme();
}).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

export function createInterfaceSettings() {
    const translations = getSettingTranslationPatches();
    return [
        {
            id: LANGUAGE_SETTING_ID,
            ...translations[LANGUAGE_SETTING_ID],
            type: 'combo',
            defaultValue: () => normalizeLanguagePreference(localStorage.getItem('anomalous_lang')),
            onChange: applyLanguagePreference
        },
        {
            id: THEME_SETTING_ID,
            ...translations[THEME_SETTING_ID],
            type: 'combo',
            defaultValue: () => themePreference(),
            onChange(value) {
                setThemePreference(value, true);
            }
        }
    ];
}
