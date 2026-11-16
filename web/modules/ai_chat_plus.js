/**
 * Pure helpers for message attachment ref notes and POST /message serialization (no DOM).
 */

export const MAX_REF_NOTE = 120;

/** `note` capped at `MAX_REF_NOTE` characters for a tray chip's input. */
export function refNote(note) {
    return String(note ?? '').slice(0, MAX_REF_NOTE);
}

/** Shapes a `ref` for POST /message, emitting `attached: true` only when attached and omitting empty `note`. */
export function serializeRef(ref) {
    const note = String(ref?.note ?? '').trim().slice(0, MAX_REF_NOTE);
    return {
        kind: ref.kind,
        id: ref.id,
        label: ref.label,
        ...(ref?.attached ? { attached: true } : {}),
        ...(note ? { note } : {}),
    };
}

/** Maps `refs` with `serializeRef`. */
export const serializeRefs = refs => (refs || []).map(serializeRef);
