import { loadSettings, saveSettings, validateSettings } from './settings-store.js?v=17';
import { generateTurnTestCode, generateArduinoCode } from './arduino-exporter.js?v=21';
import {
  turnTargets,
  suggestTurnTicks,
  applyTurnSuggestion,
  buildTrialsFromRoute,
  saveActiveRunState,
  loadActiveRunState,
} from './turn-calibration.js?v=2';
import { ARENA, buildArenaState, rollDirectionDie, rollBoxDice } from './arena-state.js?v=9';
import { planRoute } from './path-planner.js?v=20';

const $ = (selector) => document.querySelector(selector);

let settings = loadSettings(localStorage);
let currentRoute = null;
let currentDiceState = null;
let currentTrials = [];
let generatedTest = null;
let suggestions = [];
let currentFieldCode = '';

const directionSelect = $('#direction-die');
const leftSelect = $('#left-die');
const rightSelect = $('#right-die');
const planningModeSelect = $('#planning-mode');
const customAnglesToggle = $('#custom-angles-toggle');
const randomizeBtn = $('#randomize-dice');
const generateTestBtn = $('#generate-test');
const calculateTicksBtn = $('#calculate-ticks');
const saveTicksBtn = $('#save-ticks');
const downloadTestBtn = $('#download-test');
const copyTestBtn = $('#copy-test');
const downloadFieldBtn = $('#download-field-route');
const copyFieldBtn = $('#copy-field-route');
const retestBtn = $('#retest-btn');

function status(selector, message, error = false) {
  const el = $(selector);
  if (!el) return;
  el.textContent = message;
  el.dataset.error = String(error);
}

function updateStepper(activeStep) {
  for (let s = 1; s <= 3; s++) {
    const node = $(`#stepper-${s}`);
    const line = $(`#line-${s}-${s + 1}`);
    if (node) {
      node.classList.remove('active', 'completed');
      if (s < activeStep) {
        node.classList.add('completed');
      } else if (s === activeStep) {
        node.classList.add('active');
      }
    }
    if (line) {
      if (s < activeStep) {
        line.style.background = '#22c55e';
      } else {
        line.style.background = 'rgba(255, 255, 255, 0.1)';
      }
    }
  }
}

// Stepper click to navigate
for (let s = 1; s <= 3; s++) {
  const node = $(`#stepper-${s}`);
  if (node) {
    node.addEventListener('click', () => {
      if (s === 1) $('#card-dice')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (s === 2) $('#card-generator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else if (s === 3 && !$('#field-export-panel')?.hidden) {
        $('#field-export-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }
}

function readDice() {
  return {
    directionDie: Number(directionSelect.value),
    leftDie: Number(leftSelect.value),
    rightDie: Number(rightSelect.value),
  };
}

function renderRouteDisplay(route) {
  const statusPill = $('#route-status-pill');
  const metrics = $('#route-metrics');
  const stepsContainer = $('#route-steps-display');

  if (!route || route.status !== 'found') {
    statusPill.textContent = 'ไม่พบเส้นทาง';
    statusPill.dataset.state = 'error';
    metrics.textContent = route?.reason || 'ลองเปลี่ยนแต้มลูกเต๋าหรือตำแหน่งสิ่งกีดขวาง';
    stepsContainer.innerHTML = '<span class="route-step-chip">ไม่มีคำสั่งการเดิน</span>';
    return;
  }

  statusPill.textContent = 'พบเส้นทาง';
  statusPill.dataset.state = 'ok';
  const totalDist = route.totalDistance ?? route.totalDistanceM ?? 0;
  const estSec = route.estimatedSeconds ?? route.estimatedSec ?? 0;
  const turns = route.turnCount ?? 0;
  const goalDesc = route.goalType === 'bonus' ? 'ช่องซ้าย 19" (+1 คะแนน)' : 'ช่องขวา 20" (ปกติ)';
  metrics.textContent = `เป้าหมาย: ${goalDesc} · รวม: ${totalDist.toFixed(2)} ม. · เลี้ยว: ${turns} ครั้ง · เวลา: ~${estSec.toFixed(1)} วิ`;

  stepsContainer.innerHTML = '';
  (route.commands || []).forEach((cmd, idx) => {
    const chip = document.createElement('span');
    const isTurn = cmd.type && cmd.type.startsWith('turn-');
    chip.className = `route-step-chip${isTurn ? ' turn-chip' : ''}`;
    if (isTurn) {
      const dir = cmd.type === 'turn-left' ? 'left' : 'right';
      let targets = { leftTicks: 0, rightTicks: 0 };
      try {
        targets = turnTargets(settings, dir, cmd.degrees);
      } catch {
        // fallback
      }
      chip.innerHTML = `<span class="turn-badge">${cmd.type === 'turn-left' ? '↩ หมุนซ้าย' : '↪ หมุนขวา'}</span> [${idx + 1}] ${cmd.degrees}° (L ${targets.leftTicks}/R ${targets.rightTicks} ticks)`;
    } else {
      chip.textContent = `[${idx + 1}] ${cmd.label}`;
    }
    stepsContainer.appendChild(chip);
  });
}

function renderTrialRows() {
  const trialGrid = $('#trial-grid');
  if (!trialGrid) return;
  trialGrid.innerHTML = '';

  const isManual = customAnglesToggle?.checked;
  $('#turns-intro').textContent = isManual
    ? 'โหมดปรับแต่งมุมเอง: กำหนดทิศและมุมเป้าหมายตามต้องการ'
    : `มุมเลี้ยวที่พบในเส้นทางที่ต้องทดสอบ (${currentTrials.length} รูปแบบ):`;

  currentTrials.forEach((trial, index) => {
    const trialNum = index + 1;
    let targets = { leftTicks: 0, rightTicks: 0 };
    try {
      targets = turnTargets(settings, trial.direction, trial.degrees);
    } catch {
      targets = { leftTicks: 0, rightTicks: 0 };
    }

    const stepInfo = trial.steps?.length ? `ใช้ในสเต็ปที่ [${trial.steps.join(', ')}]` : '';
    const card = document.createElement('div');
    card.className = 'turn-card';
    card.dataset.trialIndex = String(trialNum);

    if (isManual) {
      card.innerHTML = `
        <div class="turn-card-top">
          <div class="turn-label-badge">
            <span class="cmd-pill">คำสั่ง ${trialNum} (พิมพ์ ${trialNum})</span>
            <span class="usage-pill">กำหนดเอง</span>
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
            <select class="trial-direction modern-select" style="width: auto; padding: 0.35rem 0.65rem;">
              <option value="right"${trial.direction === 'right' ? ' selected' : ''}>หมุนขวา</option>
              <option value="left"${trial.direction === 'left' ? ' selected' : ''}>หมุนซ้าย</option>
            </select>
            <input class="trial-degrees" type="number" min="1" max="180" step="0.5" value="${trial.degrees}" style="width: 5.5rem; min-height: 2.2rem; padding: 0.35rem 0.55rem; color: #fff; background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 0.5rem;">
            <span>°</span>
          </div>
        </div>

        <div class="turn-card-stats">
          <div class="stat-col">
            <span class="stat-label">เป้าหมาย</span>
            <strong class="stat-val">${trial.degrees}°</strong>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-col">
            <span class="stat-label">Tick เดิม</span>
            <strong class="stat-val text-cyan trial-targets">L ${targets.leftTicks} / R ${targets.rightTicks}</strong>
          </div>
        </div>

        <div class="turn-card-action">
          <label class="turn-input-group">
            <span class="input-title">📐 ผลการหมุนจริงบนพื้นสนาม (องศา)</span>
            <div class="number-input-wrap">
              <input class="actual-degrees" data-index="${trialNum}" type="number" min="0.1" max="360" step="0.5" inputmode="decimal" placeholder="กรอกองศา เช่น ${trial.degrees - 6}">
              <span class="unit-text">°</span>
            </div>
          </label>
          <div class="turn-live-result">
            <span class="result-title">ผลการวิเคราะห์ & ค่า Tick ใหม่:</span>
            <output class="trial-suggestion" data-suggestion="${trialNum}">⚪ กรอกมุมจริงที่วัดได้เพื่อคำนวณ Tick อัตโนมัติ</output>
          </div>
        </div>
      `;
      card.querySelector('.trial-direction').addEventListener('change', onManualTrialChange);
      card.querySelector('.trial-degrees').addEventListener('input', onManualTrialChange);
    } else {
      card.innerHTML = `
        <div class="turn-card-top">
          <div class="turn-label-badge">
            <span class="cmd-pill">คำสั่ง ${trialNum} (ส่งเลข ${trialNum} ใน Serial)</span>
            <span class="usage-pill">${stepInfo || 'จากเส้นทาง'}</span>
          </div>
          <div class="turn-name">
            <span class="turn-icon">${trial.direction === 'right' ? '↪️' : '↩️'}</span>
            <strong>${trial.label || (trial.direction === 'right' ? 'หมุนขวา' : 'หมุนซ้าย') + ' ' + trial.degrees + '°'}</strong>
          </div>
        </div>

        <div class="turn-card-stats">
          <div class="stat-col">
            <span class="stat-label">เป้าหมาย</span>
            <strong class="stat-val">${trial.degrees}°</strong>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-col">
            <span class="stat-label">Tick เดิม</span>
            <strong class="stat-val text-cyan trial-targets">L ${targets.leftTicks} / R ${targets.rightTicks}</strong>
          </div>
        </div>

        <div class="turn-card-action">
          <label class="turn-input-group">
            <span class="input-title">📐 ผลการหมุนจริงบนพื้นสนาม (องศา)</span>
            <div class="input-with-presets">
              <div class="number-input-wrap">
                <input class="actual-degrees" data-index="${trialNum}" type="number" min="0.1" max="360" step="0.5" inputmode="decimal" placeholder="เช่น ${trial.degrees - 6}">
                <span class="unit-text">°</span>
              </div>
              <div class="preset-buttons" data-trial="${trialNum}">
                <button type="button" class="preset-chip" data-delta="-10">-10°</button>
                <button type="button" class="preset-chip" data-delta="-5">-5°</button>
                <button type="button" class="preset-chip" data-val="${trial.degrees}">พอดี (${trial.degrees}°)</button>
                <button type="button" class="preset-chip" data-delta="5">+5°</button>
                <button type="button" class="preset-chip" data-delta="10">+10°</button>
              </div>
            </div>
          </label>

          <div class="turn-live-result">
            <span class="result-title">ผลการวิเคราะห์ & ค่า Tick ใหม่:</span>
            <output class="trial-suggestion" data-suggestion="${trialNum}">⚪ กรอกมุมจริงที่วัดได้ด้านบน เพื่อคำนวณ Tick อัตโนมัติ</output>
          </div>
        </div>
      `;

      card.querySelectorAll('.preset-chip').forEach((btn) => {
        btn.addEventListener('click', () => {
          const inp = card.querySelector(`.actual-degrees[data-index="${trialNum}"]`);
          if (!inp) return;
          if (btn.dataset.val !== undefined) {
            inp.value = btn.dataset.val;
          } else if (btn.dataset.delta !== undefined) {
            const current = Number(inp.value) || trial.degrees;
            inp.value = String(Math.max(1, current + Number(btn.dataset.delta)));
          }
          onActualAngleInput(trialNum, trial, targets);
        });
      });
    }

    const actualInput = card.querySelector(`.actual-degrees[data-index="${trialNum}"]`);
    if (actualInput) {
      actualInput.addEventListener('input', () => {
        onActualAngleInput(trialNum, trial, targets);
      });
    }

    trialGrid.appendChild(card);
  });
}

function onManualTrialChange() {
  const rows = [...document.querySelectorAll('#trial-grid .turn-card')];
  currentTrials = rows.map((row, idx) => {
    const dir = row.querySelector('.trial-direction')?.value || 'right';
    const deg = Number(row.querySelector('.trial-degrees')?.value || 90);
    return {
      trialIndex: idx + 1,
      direction: dir,
      degrees: deg,
      label: `${dir === 'right' ? 'หมุนขวา' : 'หมุนซ้าย'} ${deg}°`,
      steps: [],
    };
  });
  invalidateTestCode();
  updateTrialOutputs();
}

function updateTrialOutputs() {
  currentTrials.forEach((trial, index) => {
    const trialNum = index + 1;
    const row = document.querySelector(`#trial-grid [data-trial-index="${trialNum}"]`);
    if (!row) return;
    const output = row.querySelector('.trial-targets');
    if (!output) return;
    try {
      const targets = turnTargets(settings, trial.direction, trial.degrees);
      output.textContent = `L ${targets.leftTicks} / R ${targets.rightTicks}`;
    } catch {
      output.textContent = 'ระบุมุม 1–180°';
    }
  });
}

function onActualAngleInput(trialNum, trial, targets) {
  const input = document.querySelector(`.actual-degrees[data-index="${trialNum}"]`);
  const output = document.querySelector(`[data-suggestion="${trialNum}"]`);
  if (!input || !output) return;

  const val = Number(input.value);
  if (!input.value.trim() || !Number.isFinite(val) || val <= 0) {
    output.textContent = '⚪ กรอกมุมจริงที่วัดได้ด้านบน เพื่อคำนวณ Tick อัตโนมัติ';
    output.className = 'trial-suggestion';
    checkCanSave();
    return;
  }

  try {
    const suggestion = suggestTurnTicks({
      targetDegrees: trial.degrees,
      actualDegrees: val,
      leftTicks: targets.leftTicks,
      rightTicks: targets.rightTicks,
    });
    const err = suggestion.errorDegrees;
    const diffDesc = Math.abs(err) < 0.5
      ? '🎉 ตรงเป๊ะ!'
      : (err < 0 ? `หมุนขาด ${err.toFixed(1)}°` : `หมุนเกิน +${err.toFixed(1)}°`);
    const deltaL = suggestion.leftTicks - targets.leftTicks;
    const deltaR = suggestion.rightTicks - targets.rightTicks;
    const deltaText = ` (${deltaL >= 0 ? '+' : ''}${deltaL}/${deltaR >= 0 ? '+' : ''}${deltaR} ticks)`;

    output.innerHTML = `<span style="font-weight:750;">${diffDesc}</span> ➔ แนะนำ: <strong style="color: #38bdf8;">L ${suggestion.leftTicks} / R ${suggestion.rightTicks}</strong><small style="color: var(--text-muted);">${deltaText}</small>`;
    output.className = `trial-suggestion ${Math.abs(err) < 2 ? 'success' : 'warning'}`;
  } catch (err) {
    output.textContent = `⚠️ ${err.message}`;
    output.className = 'trial-suggestion';
  }
  checkCanSave();
}

function checkCanSave() {
  const inputs = [...document.querySelectorAll('.actual-degrees[data-index]')];
  const filled = inputs.filter((inp) => inp.value.trim() && Number(inp.value) > 0);
  const hasAny = filled.length > 0;
  saveTicksBtn.disabled = !hasAny;
  calculateTicksBtn.disabled = !hasAny;

  const saveInfoTitle = $('#save-info-title');
  if (saveInfoTitle) {
    saveInfoTitle.textContent = hasAny
      ? `✓ พร้อมบันทึก: กรอกผลแล้ว ${filled.length} จาก ${currentTrials.length} คำสั่ง`
      : 'ระบบคำนวณ Tick ให้อัตโนมัติทันทีที่กรอกตัวเลข';
  }
}

function invalidateTestCode() {
  generatedTest = null;
  suggestions = [];
  $('#test-code-panel').hidden = true;
  calculateTicksBtn.disabled = true;
  saveTicksBtn.disabled = true;
  $('#field-export-panel').hidden = true;
  document.querySelectorAll('.trial-suggestion').forEach((o) => {
    o.textContent = '⚪ กรอกมุมจริงที่วัดได้ด้านบน เพื่อคำนวณ Tick อัตโนมัติ';
    o.className = 'trial-suggestion';
  });
  status('#generate-status', 'มีการปรับเปลี่ยนมุม กรุณากดสร้างโค้ดทดสอบใหม่');
  status('#result-status', '');
  updateStepper(1);
}

function computeRoute() {
  const dice = readDice();
  const planningMode = planningModeSelect.value;
  currentDiceState = buildArenaState(dice);
  currentRoute = planRoute({
    arena: ARENA,
    diceState: currentDiceState,
    settings: { ...settings, planningMode },
  });

  saveActiveRunState(localStorage, {
    dice,
    planningMode,
    timestamp: Date.now(),
  });

  renderRouteDisplay(currentRoute);

  if (currentRoute?.status !== 'found') {
    currentTrials = [];
    $('#trial-grid').innerHTML = '<div style="color: #ff8e80; padding: 1rem; background: rgba(244,63,94,0.1); border-radius: 0.75rem; border: 1px solid rgba(244,63,94,0.3);">⚠ ไม่พบเส้นทางที่วิ่งได้สำหรับแต้มลูกเต๋านี้ กรุณาเปลี่ยนแต้มลูกเต๋าหรือตำแหน่งสิ่งกีดขวาง</div>';
    generateTestBtn.disabled = true;
    calculateTicksBtn.disabled = true;
    saveTicksBtn.disabled = true;
    return;
  }

  generateTestBtn.disabled = false;
  if (!customAnglesToggle.checked) {
    currentTrials = buildTrialsFromRoute(currentRoute, [{ direction: 'right', degrees: 90, label: 'หมุนขวา 90°' }]);
  } else if (!currentTrials.length) {
    currentTrials = [
      { trialIndex: 1, direction: 'right', degrees: 90, label: 'หมุนขวา 90°', steps: [] },
      { trialIndex: 2, direction: 'left', degrees: 90, label: 'หมุนซ้าย 90°', steps: [] },
    ];
  }

  renderTrialRows();
  invalidateTestCode();
  status('#sync-status', '⚡ ซิงค์เส้นทางกับหน้าแผนที่แล้ว');
}

// Event Listeners
[directionSelect, leftSelect, rightSelect, planningModeSelect].forEach((el) => {
  el.addEventListener('change', computeRoute);
});

randomizeBtn.addEventListener('click', () => {
  directionSelect.value = String(rollDirectionDie());
  leftSelect.value = String(rollBoxDice());
  rightSelect.value = String(rollBoxDice());
  computeRoute();
});

customAnglesToggle.addEventListener('change', () => {
  if (customAnglesToggle.checked) {
    if (!currentTrials.length) {
      currentTrials = [
        { trialIndex: 1, direction: 'right', degrees: 90, label: 'หมุนขวา 90°', steps: [] },
        { trialIndex: 2, direction: 'left', degrees: 90, label: 'หมุนซ้าย 90°', steps: [] },
      ];
    }
  } else {
    currentTrials = buildTrialsFromRoute(currentRoute, [{ direction: 'right', degrees: 90, label: 'หมุนขวา 90°' }]);
  }
  renderTrialRows();
  invalidateTestCode();
});

generateTestBtn.addEventListener('click', () => {
  try {
    if (!currentTrials.length) {
      throw new RangeError('ไม่พบมุมทดสอบ กรุณาเลือกแต้มลูกเต๋าหรือระบุมุม');
    }
    const trialsWithTargets = currentTrials.map((t) => {
      const targets = turnTargets(settings, t.direction, t.degrees);
      return { ...t, ...targets };
    });
    const code = generateTurnTestCode({ trials: trialsWithTargets, settings });
    generatedTest = { code, trials: trialsWithTargets };

    $('#test-code').textContent = code;
    $('#test-code-panel').hidden = false;
    downloadTestBtn.disabled = false;
    copyTestBtn.disabled = false;
    checkCanSave();

    status(
      '#generate-status',
      `✓ โค้ดทดสอบพร้อมใช้งาน (${currentTrials.length} คำสั่ง) — อัปโหลดลง Arduino แล้วเปิด Serial Monitor (115200 baud) ส่งเลข 1-${currentTrials.length}`,
    );
    status('#result-status', '');
    updateStepper(2);
  } catch (error) {
    generatedTest = null;
    $('#test-code-panel').hidden = true;
    downloadTestBtn.disabled = true;
    copyTestBtn.disabled = true;
    saveTicksBtn.disabled = true;
    status('#generate-status', error.message, true);
  }
});

downloadTestBtn.addEventListener('click', () => {
  if (!generatedTest) return;
  const url = URL.createObjectURL(new Blob([generatedTest.code], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'TurnCalibration.ino';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

copyTestBtn.addEventListener('click', async () => {
  if (!generatedTest) return;
  try {
    await navigator.clipboard.writeText(generatedTest.code);
    status('#generate-status', '📋 คัดลอกโค้ดทดสอบ TurnCalibration.ino ลง Clipboard แล้ว!');
  } catch {
    status('#generate-status', 'คัดลอกไม่สำเร็จ กรุณาใช้ปุ่มดาวน์โหลดไฟล์', true);
  }
});

calculateTicksBtn.addEventListener('click', () => {
  collectAndValidateSuggestions();
});

function collectAndValidateSuggestions() {
  const next = [];
  currentTrials.forEach((trial, index) => {
    const trialNum = index + 1;
    const input = document.querySelector(`.actual-degrees[data-index="${trialNum}"]`);
    if (!input || !input.value.trim()) return;

    const actualDegrees = Number(input.value);
    const targets = turnTargets(settings, trial.direction, trial.degrees);
    const suggestion = suggestTurnTicks({
      targetDegrees: trial.degrees,
      actualDegrees,
      leftTicks: targets.leftTicks,
      rightTicks: targets.rightTicks,
    });

    if (suggestion.leftTicks > 400 || suggestion.rightTicks > 400) {
      throw new RangeError('ค่า Tick ที่คำนวณได้เกิน 400 ticks กรุณาตรวจความถูกต้องของการวัดมุม');
    }
    next.push({ trial, suggestion });
  });

  if (!next.length) {
    throw new RangeError('กรุณากรอกมุมจริงอย่างน้อย 1 รายการก่อนคำนวณ');
  }

  suggestions = next;
  saveTicksBtn.disabled = false;
  return next;
}

saveTicksBtn.addEventListener('click', () => {
  try {
    collectAndValidateSuggestions();
    if (!suggestions.length) return;

    let nextSettings = { ...settings };
    for (const { trial, suggestion } of suggestions) {
      nextSettings = applyTurnSuggestion(nextSettings, trial.direction, trial.degrees, suggestion);
    }

    const validation = validateSettings(nextSettings);
    if (!validation.ok) {
      status('#result-status', Object.values(validation.errors).join(' · '), true);
      return;
    }

    settings = saveSettings(localStorage, validation.value);
    computeRoute();

    // Generate updated field sketch
    currentFieldCode = generateArduinoCode({
      route: currentRoute,
      diceState: currentDiceState,
      settings,
      arena: ARENA,
      profile: 'encoder',
    });

    $('#field-code-display').textContent = currentFieldCode;
    $('#field-export-panel').hidden = false;

    // Refresh test code
    const trialsWithTargets = currentTrials.map((t) => {
      const targets = turnTargets(settings, t.direction, t.degrees);
      return { ...t, ...targets };
    });
    const newTestCode = generateTurnTestCode({ trials: trialsWithTargets, settings });
    generatedTest = { code: newTestCode, trials: trialsWithTargets };
    $('#test-code').textContent = newTestCode;

    status(
      '#result-status',
      '✅ บันทึก Tick สำเร็จเรียบร้อย! โค้ดสนามจริงและคำสั่งหมุนถูกอัปเดตแล้ว สามารถดาวน์โหลดด้านล่างได้เลย',
    );
    status('#generate-status', '⚡ ค่า Tick ได้รับการอัปเดตลงในโค้ดทดสอบใหม่เรียบร้อยแล้ว');
    updateStepper(3);

    // Smooth scroll to the field code card
    setTimeout(() => {
      $('#field-export-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  } catch (error) {
    status('#result-status', error.message, true);
  }
});

downloadFieldBtn.addEventListener('click', () => {
  if (!currentFieldCode) return;
  const url = URL.createObjectURL(new Blob([currentFieldCode], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'RobotRoute.ino';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

copyFieldBtn.addEventListener('click', async () => {
  if (!currentFieldCode) return;
  try {
    await navigator.clipboard.writeText(currentFieldCode);
    status('#result-status', '📋 คัดลอกโค้ดสนามจริง (RobotRoute.ino) เรียบร้อย!');
  } catch {
    status('#result-status', 'คัดลอกไม่สำเร็จ กรุณาใช้ปุ่มดาวน์โหลดไฟล์', true);
  }
});

retestBtn.addEventListener('click', () => {
  document.querySelectorAll('.actual-degrees').forEach((inp) => { inp.value = ''; });
  document.querySelectorAll('.trial-suggestion').forEach((out) => {
    out.textContent = '⚪ กรอกมุมจริงที่วัดได้ด้านบน เพื่อคำนวณ Tick อัตโนมัติ';
    out.className = 'trial-suggestion';
  });
  suggestions = [];
  saveTicksBtn.disabled = true;
  calculateTicksBtn.disabled = true;
  status('#result-status', 'พร้อมทดสอบซ้ำ: อัปโหลด TurnCalibration.ino ใหม่แล้วส่งคำสั่งอีกครั้ง');
  updateStepper(2);
  $('#card-generator')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Initialize on Load
function initialize() {
  const activeRun = loadActiveRunState(localStorage);
  if (activeRun?.dice) {
    if (activeRun.dice.directionDie) directionSelect.value = String(activeRun.dice.directionDie);
    if (activeRun.dice.leftDie) leftSelect.value = String(activeRun.dice.leftDie);
    if (activeRun.dice.rightDie) rightSelect.value = String(activeRun.dice.rightDie);
  }
  if (activeRun?.planningMode && planningModeSelect) {
    planningModeSelect.value = activeRun.planningMode;
  }
  computeRoute();
}

initialize();
