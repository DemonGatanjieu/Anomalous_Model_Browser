import { app } from '../../../scripts/app.js';
import { t } from './interface_settings.js';

let scriptDirectorPanel = null;
let linesContainer = null;
let scriptLines = [];
let activeLineIndex = null;
let onVoiceSelectedCallback = null;

export function openScriptDirector(parentContainer) {
    if (!scriptDirectorPanel) {
        createScriptDirectorUI(parentContainer);
    } else if (scriptDirectorPanel.parentNode !== parentContainer) {
        parentContainer.appendChild(scriptDirectorPanel);
    }
    scriptDirectorPanel.style.display = 'flex';
}

export function closeScriptDirector() {
    if (scriptDirectorPanel) {
        scriptDirectorPanel.style.display = 'none';
    }
}

export function handleVoiceSelectionForScript(voiceData) {
    if (activeLineIndex !== null && scriptLines[activeLineIndex]) {
        scriptLines[activeLineIndex].voice = voiceData;
        renderLines();
    }
}

export function isScriptDirectorActive() {
    return scriptDirectorPanel && scriptDirectorPanel.style.display === 'flex' && scriptDirectorPanel.parentNode !== null;
}

function createScriptDirectorUI(parentContainer) {
    scriptDirectorPanel = document.createElement('div');
    scriptDirectorPanel.className = 'anomalous-script-director-panel';
    scriptDirectorPanel.style.display = 'none';
    
    const header = document.createElement('div');
    header.className = 'anomalous-sd-header';
    
    const titleGroup = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'anomalous-sd-title';
    title.textContent = t('scriptDirectorTitle');
    const subtitle = document.createElement('div');
    subtitle.className = 'anomalous-sd-subtitle';
    subtitle.textContent = t('scriptDirectorSubtitle');
    titleGroup.appendChild(title);
    titleGroup.appendChild(subtitle);
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'anomalous-sd-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = closeScriptDirector;
    
    header.appendChild(titleGroup);
    header.appendChild(closeBtn);
    
    const inputContainer = document.createElement('div');
    inputContainer.className = 'anomalous-sd-input-area';
    
    const textarea = document.createElement('textarea');
    textarea.className = 'anomalous-sd-textarea';
    textarea.placeholder = t('scriptDirectorInputPlaceholder');
    
    const parseBtn = document.createElement('button');
    parseBtn.className = 'anomalous-sd-btn primary';
    parseBtn.textContent = t('scriptDirectorParse');
    parseBtn.onclick = () => parseScriptText(textarea.value);
    
    inputContainer.appendChild(textarea);
    inputContainer.appendChild(parseBtn);
    
    linesContainer = document.createElement('div');
    linesContainer.className = 'anomalous-sd-lines-container';
    
    const footer = document.createElement('div');
    footer.className = 'anomalous-sd-footer';
    
    const clearBtn = document.createElement('button');
    clearBtn.className = 'anomalous-sd-btn';
    clearBtn.textContent = t('scriptDirectorClear');
    clearBtn.onclick = () => {
        scriptLines = [];
        textarea.value = '';
        renderLines();
    };
    
    const injectBtn = document.createElement('button');
    injectBtn.className = 'anomalous-sd-btn accent';
    injectBtn.textContent = t('scriptDirectorInject');
    injectBtn.onclick = injectToNode;
    
    footer.appendChild(clearBtn);
    footer.appendChild(injectBtn);
    
    scriptDirectorPanel.appendChild(header);
    scriptDirectorPanel.appendChild(inputContainer);
    scriptDirectorPanel.appendChild(linesContainer);
    scriptDirectorPanel.appendChild(footer);
    
    parentContainer.appendChild(scriptDirectorPanel);
}

function parseScriptText(text) {
    if (!text.trim()) return;
    
    // Split by punctuation: 。！？.!? or newlines, keeping the punctuation
    const regex = /([^。！？.!?\n]+[。！？.!?\n]*)/g;
    const matches = text.match(regex);
    
    if (matches) {
        const newLines = matches.map(m => m.trim()).filter(m => m.length > 0);
        // Append to existing or replace? Let's replace for simplicity
        scriptLines = newLines.map(text => ({ text, voice: null }));
        activeLineIndex = null;
        renderLines();
    }
}

function renderLines() {
    linesContainer.innerHTML = '';
    scriptLines.forEach((line, index) => {
        const card = document.createElement('div');
        card.className = `anomalous-sd-line-card ${activeLineIndex === index ? 'active' : ''}`;
        card.onclick = () => {
            activeLineIndex = index;
            renderLines();
        };
        
        const badgeContainer = document.createElement('div');
        badgeContainer.className = 'anomalous-sd-voice-badge';
        
        if (line.voice) {
            badgeContainer.classList.add('has-voice');
            badgeContainer.innerHTML = `<span class="voice-icon">🎙️</span><span class="voice-name">${line.voice.character}</span>`;
        } else {
            badgeContainer.innerHTML = `<span class="voice-name placeholder">未指定音色 (No Voice)</span>`;
        }
        
        const textElem = document.createElement('div');
        textElem.className = 'anomalous-sd-line-text';
        textElem.textContent = line.text;
        
        card.appendChild(badgeContainer);
        card.appendChild(textElem);
        linesContainer.appendChild(card);
    });
}

function injectToNode() {
    if (scriptLines.length === 0) return;
    
    // Compile string
    let finalString = '';
    scriptLines.forEach(line => {
        if (line.voice && line.voice.audio_path) {
            // Usually path needs to be relative to input or just the filename depending on F5-TTS implementation
            // The user's screenshot showed: F5-TTS\Arona_angry.wav
            finalString += `{${line.voice.audio_path}} ${line.text}\n`;
        } else {
            finalString += `${line.text}\n`;
        }
    });
    
    finalString = finalString.trim();
    
    // Find node
    const nodes = app.graph.findNodesByType("F5TTSAudio");
    if (nodes && nodes.length > 0) {
        // Use the first one
        const node = nodes[0];
        const speechWidget = node.widgets.find(w => w.name === 'speech');
        if (speechWidget) {
            speechWidget.value = finalString;
            
            // Visual feedback
            const btn = scriptDirectorPanel.querySelector('.anomalous-sd-btn.accent');
            const originalText = btn.textContent;
            btn.textContent = t('scriptDirectorSuccess');
            btn.style.background = '#10b981';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.background = '';
            }, 2000);
            return;
        }
    }
    
    alert(t('scriptDirectorNoNode'));
}
