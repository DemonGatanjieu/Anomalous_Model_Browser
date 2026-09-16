import { app } from '../../../scripts/app.js';
import { normalizeLocale, resolveLocale, translate } from './locales.js';

export const LANGUAGE_SETTING_ID = 'Anomalous.ModelBrowser.Language';
export const ABYSSAL_SCARLET_SETTING_ID = 'Anomalous.ModelBrowser.AbyssalScarletTheme';

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
        [ABYSSAL_SCARLET_SETTING_ID]: {
            name: t('mainAbyssalScarletThemeSetting'),
            category: ['Anomalous Model Browser', category, 'theme'],
            tooltip: t('mainAbyssalScarletThemeTooltip')
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

function applyLanguagePreference(value) {
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

export function setAbyssalScarletTheme(enabled, notify = false) {
    const isEnabled = Boolean(enabled);
    localStorage.setItem('anomalous_theme_abyssal_scarlet', isEnabled ? 'true' : 'false');
    document.documentElement.classList.toggle('theme-abyssal-scarlet', isEnabled);
    document.getElementById('anomalous-modal')?.classList.toggle('theme-abyssal-scarlet', isEnabled);
    document.getElementById('anomalous-container')?.classList.toggle('theme-abyssal-scarlet', isEnabled);

    try {
        const settings = app.extensionManager?.setting;
        if (settings && typeof settings.set === 'function' && settings.get(ABYSSAL_SCARLET_SETTING_ID) !== isEnabled) {
            settings.set(ABYSSAL_SCARLET_SETTING_ID, isEnabled);
        }
    } catch (_) {}

    if (notify) showThemeNoticeToast(isEnabled);
    window.dispatchEvent(new CustomEvent('anomalous-theme-change', {
        detail: { theme: isEnabled ? 'abyssal-scarlet' : 'default', enabled: isEnabled }
    }));
}

window.setAbyssalScarletTheme = setAbyssalScarletTheme;
setAbyssalScarletTheme(localStorage.getItem('anomalous_theme_abyssal_scarlet') === 'true', false);

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
            id: ABYSSAL_SCARLET_SETTING_ID,
            ...translations[ABYSSAL_SCARLET_SETTING_ID],
            type: 'boolean',
            defaultValue: () => localStorage.getItem('anomalous_theme_abyssal_scarlet') === 'true',
            onChange(value) {
                setAbyssalScarletTheme(Boolean(value), true);
            }
        }
    ];
}
