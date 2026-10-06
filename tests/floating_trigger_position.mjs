import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeFloatingTriggerSize,
    normalizeFloatingTriggerStyle,
    normalizeEntryMode,
    isValidSavedTriggerPosition,
    normalizeSavedTriggerPosition,
    clampFloatingTriggerPosition,
    loadSavedTriggerPosition,
    saveTriggerPosition,
    clearSavedTriggerPosition
} from '../web/modules/entry_controls.js';

test('normalizeFloatingTriggerSize returns default for invalid values', () => {
    assert.equal(normalizeFloatingTriggerSize('small'), 'small');
    assert.equal(normalizeFloatingTriggerSize('medium'), 'medium');
    assert.equal(normalizeFloatingTriggerSize('large'), 'large');
    assert.equal(normalizeFloatingTriggerSize('invalid'), 'medium');
    assert.equal(normalizeFloatingTriggerSize(null), 'medium');
    assert.equal(normalizeFloatingTriggerSize(undefined), 'medium');
});

test('normalizeFloatingTriggerStyle returns default for invalid values', () => {
    assert.equal(normalizeFloatingTriggerStyle('icon'), 'icon');
    assert.equal(normalizeFloatingTriggerStyle('pill'), 'pill');
    assert.equal(normalizeFloatingTriggerStyle('unknown'), 'icon');
    assert.equal(normalizeFloatingTriggerStyle(null), 'icon');
});

test('normalizeEntryMode returns default for invalid values', () => {
    assert.equal(normalizeEntryMode('floating'), 'floating');
    assert.equal(normalizeEntryMode('topbar'), 'topbar');
    assert.equal(normalizeEntryMode('menu'), 'menu');
    assert.equal(normalizeEntryMode('other'), 'floating');
});

test('isValidSavedTriggerPosition validates finite numeric coordinates and rejects invalid/null values', () => {
    // Nullish or empty
    assert.equal(isValidSavedTriggerPosition(null, null), false);
    assert.equal(isValidSavedTriggerPosition('100px', null), false);
    assert.equal(isValidSavedTriggerPosition(null, '100px'), false);
    assert.equal(isValidSavedTriggerPosition('', ''), false);
    assert.equal(isValidSavedTriggerPosition('NaN', 'NaN'), false);

    // Negative or non-finite coordinates are rejected
    assert.equal(isValidSavedTriggerPosition('-10px', '50px'), false);
    assert.equal(isValidSavedTriggerPosition('50px', '-10px'), false);
    assert.equal(isValidSavedTriggerPosition('Infinity', '100'), false);

    // Coordinates in dock area (<70px) are rejected as invalid legacy/dirty positions
    assert.equal(isValidSavedTriggerPosition('0px', '0px'), false);
    assert.equal(isValidSavedTriggerPosition('50px', '100px'), false);
    assert.equal(isValidSavedTriggerPosition('69px', '80px'), false);

    // Valid non-negative finite canvas positions outside dock
    assert.equal(isValidSavedTriggerPosition('70px', '80px'), true);
    assert.equal(isValidSavedTriggerPosition('100px', '200px'), true);
    assert.equal(isValidSavedTriggerPosition('500', '300'), true);
    assert.equal(isValidSavedTriggerPosition('1800px', '900px'), true);
});

test('normalizeSavedTriggerPosition preserves precise user drag coordinates without distortion', () => {
    const pos1 = normalizeSavedTriggerPosition('75px', '48px');
    assert.deepEqual(pos1, { x: 75, y: 48 });

    const pos2 = normalizeSavedTriggerPosition('120px', '80px');
    assert.deepEqual(pos2, { x: 120, y: 80 });

    const pos3 = normalizeSavedTriggerPosition('500px', '400px');
    assert.deepEqual(pos3, { x: 500, y: 400 });

    // Invalid / null coordinates return null
    assert.equal(normalizeSavedTriggerPosition(null, null), null);
    assert.equal(normalizeSavedTriggerPosition('invalid', 'invalid'), null);
    assert.equal(normalizeSavedTriggerPosition('30px', '100px'), null);
});

test('clampFloatingTriggerPosition calculates safe top-left fallback positions when coordinates are absent', () => {
    const pos = clampFloatingTriggerPosition({
        x: null,
        y: null,
        width: 60,
        height: 60,
        viewportWidth: 1920,
        viewportHeight: 1080,
        margin: 0
    });
    // Falls back cleanly to top-left safe zone (80, 80)
    assert.equal(pos.x, 80);
    assert.equal(pos.y, 80);
});

test('clampFloatingTriggerPosition provides safe fallback viewport when viewportWidth/Height is unmeasured', () => {
    const pos = clampFloatingTriggerPosition({
        x: null,
        y: null,
        width: 60,
        height: 60,
        viewportWidth: 0,
        viewportHeight: 0,
        margin: 0
    });
    // Uses safe fallback top-left position (80, 80)
    assert.equal(pos.x, 80);
    assert.equal(pos.y, 80);
});

test('clampFloatingTriggerPosition clamps coordinates within viewport boundaries', () => {
    // Coordinate beyond viewport bounds
    const overflowPos = clampFloatingTriggerPosition({
        x: '3000px',
        y: '2000px',
        width: 60,
        height: 60,
        viewportWidth: 1000,
        viewportHeight: 800,
        margin: 30
    });
    assert.equal(overflowPos.x, 940); // 1000 - 60
    assert.equal(overflowPos.y, 740); // 800 - 60

    // Coordinate with negative values clamped to min safe boundary (70, 0)
    const negativePos = clampFloatingTriggerPosition({
        x: '-50px',
        y: '-100px',
        width: 60,
        height: 60,
        viewportWidth: 1000,
        viewportHeight: 800,
        margin: 30
    });
    assert.equal(negativePos.x, 70);
    assert.equal(negativePos.y, 0);

    // Coordinate within valid range
    const validPos = clampFloatingTriggerPosition({
        x: '400px',
        y: '300px',
        width: 60,
        height: 60,
        viewportWidth: 1000,
        viewportHeight: 800,
        margin: 30
    });
    assert.equal(validPos.x, 400);
    assert.equal(validPos.y, 300);
});

test('saveTriggerPosition, loadSavedTriggerPosition and clearSavedTriggerPosition provide robust roundtrip persistence', () => {
    const mockStorage = new Map();
    const storageAdapter = {
        getItem: k => mockStorage.get(k) || null,
        setItem: (k, v) => mockStorage.set(k, String(v)),
        removeItem: k => mockStorage.delete(k)
    };

    // 1. Initial empty state returns null
    assert.equal(loadSavedTriggerPosition(storageAdapter), null);

    // 2. User drags and saves position at (949, 588)
    saveTriggerPosition({ x: 949.4, y: 588.6 }, storageAdapter);
    
    // 3. Roundtrip load retrieves exact integer coordinates
    const restored = loadSavedTriggerPosition(storageAdapter);
    assert.deepEqual(restored, { x: 949, y: 589 });

    // 4. Clamping restored coordinates in 1920x1080 viewport stays strictly at (949, 589)
    const clamped = clampFloatingTriggerPosition({
        x: restored.x,
        y: restored.y,
        width: 60,
        height: 60,
        viewportWidth: 1920,
        viewportHeight: 1080
    });
    assert.equal(clamped.x, 949);
    assert.equal(clamped.y, 589);

    // 5. Clear storage flushes memory
    clearSavedTriggerPosition(storageAdapter);
    assert.equal(loadSavedTriggerPosition(storageAdapter), null);

    // 6. Dirty legacy dock coordinates (< 70px) are rejected and purged automatically
    storageAdapter.setItem('anomalous_trigger_pos_v3', JSON.stringify({ x: 0, y: 449 }));
    assert.equal(loadSavedTriggerPosition(storageAdapter), null);
    assert.equal(storageAdapter.getItem('anomalous_trigger_pos_v3'), null);

    // 7. Attempting to save coordinates inside sidebar dock is ignored
    saveTriggerPosition({ x: 50, y: 300 }, storageAdapter);
    assert.equal(storageAdapter.getItem('anomalous_trigger_pos_v3'), null);
});

