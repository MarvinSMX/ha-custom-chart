/**
 * Custom Energy Chart Card
 * Version: 1.0.0
 *
 * HACS-compatible Lovelace card for displaying energy consumption charts,
 * similar to the native Home Assistant Energy Dashboard.
 *
 * Repository: https://github.com/YOUR_USER/custom-energy-chart-card
 *
 * Card YAML configuration:
 * ─────────────────────────
 * type: custom:custom-energy-chart-card
 * title: Stromnutzung
 * period: day           # day | week | month  (default: day)
 * unit: kWh             # display unit        (default: kWh)
 * entities:
 *   - entity: sensor.energy_building_a
 *     name: Gebäude 441 Gesamt
 *     color: "#7dbff5"
 *   - entity: sensor.energy_building_b
 *     name: Gebäude 439 Gesamt
 *     color: "#488fc2"
 *   - entity: sensor.pv_self_consumption
 *     name: PV-Eigenverbrauch
 *     color: "#ff9800"
 *     stat_type: change   # change | mean  (default: change)
 */

(function () {
  'use strict';

  const VERSION = '1.0.0';

  const DEFAULT_COLORS = [
    '#488fc2', '#7dbff5', '#ff9800', '#4db6ac',
    '#f06292', '#8353d1', '#43a047', '#e53935',
    '#fb8c00', '#00acc1', '#ab47bc', '#26a69a',
  ];

  // ─── Styles ────────────────────────────────────────────────────────────────

  const CARD_STYLES = `
    :host {
      display: block;
      height: 100%;
    }
    ha-card {
      overflow: hidden;
      height: 100%;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
    }
    .card-header {
      padding: 16px 16px 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .card-title {
      font-size: 1.1em;
      font-weight: 500;
      color: var(--primary-text-color);
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* Total chip — matches hui-energy-graph-chip */
    .total-chip {
      display: inline-flex;
      align-items: center;
      padding: 4px 12px;
      background: rgba(var(--rgb-primary-text-color, 33,33,33), 0.06);
      border-radius: 16px;
      font-size: 0.875em;
      font-weight: 500;
      color: var(--primary-text-color);
      white-space: nowrap;
      cursor: default;
      flex-shrink: 0;
    }
    .chart-wrapper {
      flex: 1;
      position: relative;
      min-height: 150px;
      overflow: hidden;
      cursor: default;
    }
    canvas {
      position: absolute;
      inset: 0;
      display: block;
    }
    .loading-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--secondary-text-color);
      font-size: 0.85em;
      font-family: var(--ha-font-family-body, Roboto, sans-serif);
    }
    .loading-overlay.error {
      color: var(--error-color, #db4437);
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 5px 14px;
      padding: 4px 16px 8px;
      justify-content: center;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 0.78em;
      color: var(--secondary-text-color);
    }
    .legend-swatch {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    /* Tooltip — matches ECharts native tooltip exactly */
    .tooltip-box {
      position: absolute;
      background: rgb(28, 28, 28);
      border: 1px solid rgba(225, 225, 225, 0.12);
      border-radius: 4px;
      padding: 10px;
      font: 12px/1.5 var(--ha-font-family-body, Roboto, Noto, sans-serif);
      color: rgb(225, 225, 225);
      pointer-events: none;
      box-shadow: 1px 2px 10px rgba(0, 0, 0, 0.2);
      z-index: 100;
      white-space: nowrap;
      opacity: 0;
      transition: opacity 0.1s;
    }
    .tooltip-box.visible { opacity: 1; }
    .tooltip-title {
      font-weight: 700;
      margin-bottom: 6px;
      text-align: center;
    }
    .tooltip-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 2px 0;
    }
    .tooltip-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
      display: inline-block;
      margin-right: 4px;
    }
    .tooltip-label { flex: 1; }
    .tooltip-value { font-weight: 400; margin-left: 8px; }
    .tooltip-total {
      margin-top: 6px;
      padding-top: 5px;
      border-top: 1px solid rgba(225, 225, 225, 0.15);
      font-weight: 700;
    }
  `;

  // ─── Main Card Element ──────────────────────────────────────────────────────

  class CustomEnergyChartCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._config = null;
      this._hass = null;
      this._data = null;
      this._energyStart = null;
      this._energyEnd   = null;
      this._unsubEnergy = null;
      this._loading = false;
      this._rendered = false;
      this._barHitAreas = [];
      this._refreshTimer = null;
    }

    // ── HA lifecycle ──────────────────────────────────────────────────────────

    setConfig(config) {
      if (!config) throw new Error('Invalid configuration');
      if (!config.entities || !Array.isArray(config.entities) || !config.entities.length) {
        throw new Error('Define at least one entity under "entities:"');
      }

      this._config = {
        title: config.title || 'Energy Usage',
        unit: config.unit || 'kWh',
        refresh_interval: Number(config.refresh_interval) || 300, // seconds
        entities: config.entities.map((e, idx) => {
          if (typeof e === 'string') {
            return {
              statistic_id: e,
              name: e,
              color: DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
              stat_type: 'change',
            };
          }
          return {
            statistic_id: e.entity || e.statistic_id || '',
            name: e.name || e.entity || e.statistic_id || `Entity ${idx + 1}`,
            color: e.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
            stat_type: e.stat_type || 'change',
          };
        }).filter(e => e.statistic_id),
      };

      if (this._rendered) {
        this._render();
        this._rendered = false; // will re-render on next hass set
      }
    }

    set hass(hass) {
      const firstSet = !this._hass;
      this._hass = hass;

      if (!this._rendered) {
        this._render();
        this._rendered = true;
      }

      if (firstSet) {
        this._subscribeEnergyCollection();
        this._startRefreshTimer();
      }
    }

    disconnectedCallback() {
      if (this._refreshTimer) {
        clearInterval(this._refreshTimer);
        this._refreshTimer = null;
      }
      if (this._unsubEnergy) {
        this._unsubEnergy();
        this._unsubEnergy = null;
      }
    }

    getCardSize() {
      return 4;
    }

    static getConfigElement() {
      return document.createElement('custom-energy-chart-card-editor');
    }

    static getStubConfig() {
      return {
        title: 'Stromnutzung',
        unit: 'kWh',
        period: 'day',
        entities: [
          { entity: 'sensor.energy_building_a', name: 'Gebäude A Gesamt', color: '#7dbff5' },
          { entity: 'sensor.energy_building_b', name: 'Gebäude B Gesamt', color: '#488fc2' },
          { entity: 'sensor.pv_self_consumption', name: 'PV-Eigenverbrauch', color: '#ff9800' },
        ],
      };
    }

    // ── Render ────────────────────────────────────────────────────────────────

    _render() {
      if (!this._config) return;
      const { title, entities } = this._config;

      this.shadowRoot.innerHTML = `
        <style>${CARD_STYLES}</style>
        <ha-card>
          <div class="card-header">
            <div class="card-title">${this._escHtml(title)}</div>
            <div class="total-chip" id="total-chip">
              <span id="total-value">-- ${this._escHtml(this._config.unit)}</span>
            </div>
          </div>

          <div class="chart-wrapper" id="chart-wrapper">
            <div class="loading-overlay" id="loading">Daten werden geladen\u2026</div>
            <canvas id="chart-canvas" style="visibility:hidden"></canvas>
            <div class="tooltip-box" id="tooltip"></div>
          </div>

          <div class="legend">
            ${entities.map(e => `
              <div class="legend-item">
                <div class="legend-swatch" style="background:${this._escHtml(e.color)}"></div>
                <span>${this._escHtml(e.name)}</span>
              </div>
            `).join('')}
          </div>
        </ha-card>
      `;

      // Canvas hover events
      const canvas = this.shadowRoot.getElementById('chart-canvas');
      canvas.addEventListener('mousemove', e => this._onMouseMove(e));
      canvas.addEventListener('mouseleave', () => this._hideTooltip());
      canvas.addEventListener('touchstart', e => {
        if (e.touches.length) this._onMouseMove(e.touches[0]);
      }, { passive: true });
    }

    // ── Energy collection subscription (native HA period selector) ────────────

    _subscribeEnergyCollection() {
      if (this._unsubEnergy) { this._unsubEnergy(); this._unsubEnergy = null; }

      const collection = this._hass?.connection?._energy;
      if (!collection) {
        // No energy dashboard configured — fall back to today/hourly
        this._fetchData();
        return;
      }

      // subscribe() calls back immediately if collection already has state
      let firedImmediately = false;
      this._unsubEnergy = collection.subscribe(state => {
        firedImmediately = true;
        if (!state) return;
        this._energyStart = state.start  ? new Date(state.start) : null;
        this._energyEnd   = state.end    ? new Date(state.end)   : null;
        this._fetchData();
      });

      // If the collection has no state yet, fetch with fallback now
      if (!firedImmediately) this._fetchData();
    }

    // ── Refresh timer ─────────────────────────────────────────────────────────

    _startRefreshTimer() {
      if (this._refreshTimer) clearInterval(this._refreshTimer);
      const ms = Math.max(60, this._config.refresh_interval) * 1000;
      this._refreshTimer = setInterval(() => this._fetchData(), ms);
    }

    // ── Statistics fetching ───────────────────────────────────────────────────

    async _fetchData() {
      if (!this._hass || !this._config || this._loading) return;
      this._loading = true;
      this._setLoadingState('loading');

      try {
        const { startTime, endTime, statPeriod } = this._getTimeRange();
        const statIds = this._config.entities.map(e => e.statistic_id);

        if (!statIds.length) {
          this._setLoadingState('error', 'Keine Entitäten konfiguriert');
          return;
        }

        const wsMsg = {
          type: 'recorder/statistics_during_period',
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          statistic_ids: statIds,
          period: statPeriod,
          types: ['change', 'mean', 'sum'],
        };
        const unitsParam = this._buildUnitsParam(this._config.unit);
        if (Object.keys(unitsParam).length) wsMsg.units = unitsParam;

        const result = await this._hass.callWS(wsMsg);

        this._processAndDraw(result || {}, startTime, endTime, statPeriod);
      } catch (err) {
        console.error('[custom-energy-chart-card]', err);
        this._setLoadingState('error', `Fehler: ${err.message || 'Statistiken nicht verfügbar'}`);
      } finally {
        this._loading = false;
      }
    }

    _getTimeRange() {
      if (this._energyStart) {
        const start    = this._energyStart;
        const end      = this._energyEnd || new Date();
        const diffDays = (end - start) / 86400000;
        // Hourly for ranges ≤ ~2 days, daily otherwise (matches native HA logic)
        const statPeriod = diffDays <= 1.5 ? 'hour' : 'day';
        return { startTime: start, endTime: end, statPeriod };
      }
      // Fallback when no energy collection is connected: today, hourly
      const now = new Date();
      return {
        startTime: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0),
        endTime:   now,
        statPeriod: 'hour',
      };
    }

    // ── Data processing ───────────────────────────────────────────────────────

    _processAndDraw(rawStats, startTime, endTime, statPeriod) {
      const slots = this._buildTimeSlots(startTime, endTime, statPeriod);

      const datasets = this._config.entities.map(entity => {
        const stats = rawStats[entity.statistic_id] || [];

        // Build a map: slotKey -> value
        const statsMap = new Map();
        stats.forEach(s => {
          const key = this._slotKey(new Date(s.start), statPeriod);
          let value;
          if (entity.stat_type === 'mean') {
            value = s.mean ?? 0;
          } else {
            // prefer 'change'; fall back to sum difference
            value = s.change ?? 0;
          }
          statsMap.set(key, Math.max(0, value));
        });

        return {
          ...entity,
          values: slots.map(slot => statsMap.get(this._slotKey(slot, statPeriod)) ?? 0),
        };
      });

      const total = datasets.reduce(
        (sum, ds) => sum + ds.values.reduce((a, b) => a + b, 0), 0
      );

      // Update total chip — "+N unit" format like hui-energy-graph-chip
      const totalEl = this.shadowRoot?.getElementById('total-value');
      if (totalEl) {
        const prefix = total > 0 ? '+' : '';
        totalEl.textContent = `${prefix}${this._fmtValue(total)} ${this._config.unit}`;
        const chip = totalEl.closest('#total-chip');
        if (chip) chip.title = `${this._fmtValue(total)} ${this._config.unit} Gesamtverbrauch`;
      }

      this._data = { slots, datasets, statPeriod };
      this._setLoadingState('done');
      this._drawChart();
    }

    _buildTimeSlots(start, end, period) {
      const slots = [];
      const cur = new Date(start);
      while (cur < end) {
        slots.push(new Date(cur));
        if (period === 'hour') cur.setHours(cur.getHours() + 1);
        else cur.setDate(cur.getDate() + 1);
      }
      return slots;
    }

    _slotKey(date, period) {
      if (period === 'hour') {
        return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
      }
      return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    }

    // ── Canvas drawing ────────────────────────────────────────────────────────

    _drawChart() {
      const canvas  = this.shadowRoot?.getElementById('chart-canvas');
      const wrapper = this.shadowRoot?.getElementById('chart-wrapper');
      if (!canvas || !wrapper || !this._data) return;

      const dpr = window.devicePixelRatio || 1;
      // Canvas is position:absolute filling the wrapper via CSS inset:0.
      // Reading wrapper dimensions is safe — canvas is out of normal flow
      // so it cannot influence wrapper height → no feedback loop.
      const W = Math.max(wrapper.clientWidth,  1);
      const H = Math.max(wrapper.clientHeight, 1);

      canvas.width  = W * dpr;
      canvas.height = H * dpr;
      // No style.width / style.height — CSS handles display size.

      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);

      // Resolve CSS theme tokens from the host element
      const cs = getComputedStyle(this.shadowRoot.host || document.documentElement);
      const secColor   = cs.getPropertyValue('--secondary-text-color').trim() || '#9b9b9b';
      const gridColor  = cs.getPropertyValue('--divider-color').trim()        || 'rgba(0,0,0,0.1)';
      const fontFamily = cs.getPropertyValue('--ha-font-family-body').trim()  || 'Roboto, sans-serif';

      const PAD = { top: 16, right: 16, bottom: 38, left: 52 };
      const cW = W - PAD.left - PAD.right;
      const cH = H - PAD.top  - PAD.bottom;

      const { slots, datasets, statPeriod } = this._data;
      const n = slots.length;
      if (!n || cW <= 0 || cH <= 0) return;

      // Per-slot stacked totals
      const totals = slots.map((_, i) =>
        datasets.reduce((s, ds) => s + (ds.values[i] || 0), 0)
      );
      const maxVal = Math.max(...totals, 0.001);
      const yMax   = this._niceMax(maxVal);
      const yTick  = this._niceTick(yMax);

      // ── Y-axis grid lines ─────────────────────────────────────────────────
      ctx.font = `10px ${fontFamily}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';

      for (let v = 0; v <= yMax + yTick * 0.01; v += yTick) {
        const y = PAD.top + cH - (v / yMax) * cH;
        if (y < PAD.top - 2) break;

        // Grid line
        ctx.strokeStyle = gridColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(PAD.left, y);
        ctx.lineTo(PAD.left + cW, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Y label
        ctx.fillStyle = secColor;
        ctx.fillText(this._fmtAxis(v), PAD.left - 5, y);
      }

      // Y unit label (rotated)
      ctx.save();
      ctx.translate(11, PAD.top + cH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = `9px ${fontFamily}`;
      ctx.fillStyle = secColor;
      ctx.fillText(this._config.unit, 0, 0);
      ctx.restore();

      // ── Bar columns ───────────────────────────────────────────────────────
      const slotW  = cW / n;
      const barPad = Math.max(1, slotW * 0.12);
      const barW   = Math.max(1, slotW - barPad * 2);

      this._barHitAreas = slots.map((slot, i) => {
        const bx = PAD.left + i * slotW + barPad;
        let stackH = 0;
        const segData = {};

        datasets.forEach(ds => {
          const val = Math.max(0, ds.values[i] || 0);
          segData[ds.statistic_id] = val;
          if (val <= 0) return;

          const bh = (val / yMax) * cH;
          const by = PAD.top + cH - stackH - bh;

          ctx.fillStyle = ds.color + '80'; // 50 % opacity — matches native ECharts bar opacity
          ctx.beginPath();

          if (stackH === 0) {
            // Bottom segment: rounded bottom corners
            const r = Math.min(barW / 3, 4);
            ctx.moveTo(bx,          by);
            ctx.lineTo(bx + barW,   by);
            ctx.lineTo(bx + barW,   by + bh - r);
            ctx.arcTo(bx + barW,    by + bh, bx + barW - r, by + bh, r);
            ctx.lineTo(bx + r,      by + bh);
            ctx.arcTo(bx,           by + bh, bx, by + bh - r, r);
            ctx.lineTo(bx,          by);
          } else {
            ctx.rect(bx, by, barW, bh);
          }
          ctx.fill();

          stackH += bh;
        });

        // X-axis label (skip labels when too dense)
        const labelStep = n <= 12 ? 1 : n <= 24 ? 2 : Math.ceil(n / 12);
        if (i % labelStep === 0 || i === n - 1) {
          ctx.fillStyle = secColor;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.font = `9px ${fontFamily}`;
          ctx.fillText(
            this._slotLabel(slot, statPeriod),
            PAD.left + (i + 0.5) * slotW,
            PAD.top + cH + 6
          );
        }

        return {
          xStart: PAD.left + i * slotW,
          xEnd:   PAD.left + (i + 1) * slotW,
          slot,
          segData,
          total: totals[i],
        };
      });
    }

    // ── Axis helpers ──────────────────────────────────────────────────────────

    _niceMax(val) {
      if (val <= 0) return 1;
      const exp = Math.floor(Math.log10(val));
      const mag = Math.pow(10, exp);
      return Math.ceil((val * 1.12) / mag) * mag;
    }

    _niceTick(max) {
      const rough = max / 5;
      const exp = Math.floor(Math.log10(rough));
      const mag = Math.pow(10, exp);
      const f   = rough / mag;
      return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
    }

    _slotLabel(date, statPeriod) {
      if (statPeriod === 'hour') {
        return `${String(date.getHours()).padStart(2, '0')}:00`;
      }
      return date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric' });
    }

    _fmtValue(val) {
      if (!val || isNaN(val)) return '0';
      if (val >= 10000) return (val / 1000).toFixed(1) + 'k';
      if (val < 10)     return val.toFixed(2);
      return val.toFixed(1);
    }

    _fmtAxis(val) {
      if (!val || isNaN(val)) return '0';
      if (val >= 1000) return (val / 1000).toFixed(1) + 'k';
      if (val < 1)     return val.toFixed(2);
      return val.toFixed(1);
    }

    // ── Loading state ─────────────────────────────────────────────────────────

    _setLoadingState(state, message) {
      const loading = this.shadowRoot?.getElementById('loading');
      const canvas  = this.shadowRoot?.getElementById('chart-canvas');
      if (!loading) return;

      if (state === 'loading') {
        loading.className = 'loading-overlay';
        loading.style.display = 'flex';
        loading.textContent = message || 'Daten werden geladen\u2026';
        if (canvas) canvas.style.visibility = 'hidden';
      } else if (state === 'error') {
        loading.className = 'loading-overlay error';
        loading.style.display = 'flex';
        loading.textContent = message || 'Fehler beim Laden der Daten';
        if (canvas) canvas.style.visibility = 'hidden';
      } else {
        loading.style.display = 'none';
        if (canvas) canvas.style.visibility = 'visible';
      }
    }

    // ── Tooltip ───────────────────────────────────────────────────────────────

    _onMouseMove(e) {
      if (!this._barHitAreas?.length) return;
      const canvas = this.shadowRoot.getElementById('chart-canvas');
      const rect   = canvas.getBoundingClientRect();
      const x      = (e.clientX ?? e.pageX) - rect.left;

      const hit = this._barHitAreas.find(b => x >= b.xStart && x < b.xEnd);
      if (hit && hit.total > 0) {
        this._showTooltip(e, hit);
      } else {
        this._hideTooltip();
      }
    }

    _showTooltip(e, hit) {
      const tooltip = this.shadowRoot?.getElementById('tooltip');
      const canvas  = this.shadowRoot?.getElementById('chart-canvas');
      if (!tooltip || !canvas) return;
      const wrapper = canvas.parentElement;

      const statPeriod = this._data?.statPeriod || 'hour';
      let title;
      if (statPeriod === 'hour') {
        const h = hit.slot.getHours();
        title = `${h}:00 \u2013 ${h + 1}:00`;
      } else {
        title = hit.slot.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
      }
      let html = `<div class="tooltip-title">${this._escHtml(title)}</div>`;

      this._config.entities.forEach(entity => {
        const val = hit.segData[entity.statistic_id] || 0;
        html += `
          <div class="tooltip-row">
            <div class="tooltip-dot" style="background:${this._escHtml(entity.color)}"></div>
            <span class="tooltip-label">${this._escHtml(entity.name)}:</span>
            <strong class="tooltip-value">${this._fmtValue(val)} ${this._escHtml(this._config.unit)}</strong>
          </div>`;
      });

      if (this._config.entities.length > 1) {
        html += `
          <div class="tooltip-total">
            <b>${this._fmtValue(hit.total)} ${this._escHtml(this._config.unit)} Gesamtverbrauch</b>
          </div>`;
      }

      tooltip.innerHTML = html;
      tooltip.classList.add('visible');

      // Position tooltip, staying in bounds
      requestAnimationFrame(() => {
        const wRect = wrapper.getBoundingClientRect();
        const cx    = (e.clientX ?? e.pageX) - wRect.left;
        const cy    = (e.clientY ?? e.pageY) - wRect.top;
        const tw    = tooltip.offsetWidth;
        const th    = tooltip.offsetHeight;

        let left = cx + 14;
        let top  = cy - th / 2;

        if (left + tw > wRect.width - 4) left = cx - tw - 14;
        if (top < 4)                      top  = 4;
        if (top + th > wRect.height - 4)  top  = wRect.height - th - 4;

        tooltip.style.left = left + 'px';
        tooltip.style.top  = top  + 'px';
      });
    }

    _hideTooltip() {
      this.shadowRoot?.getElementById('tooltip')?.classList.remove('visible');
    }

    // ── Unit category mapping ─────────────────────────────────────────────────

    _buildUnitsParam(unit) {
      const ENERGY_UNITS      = ['Wh', 'kWh', 'MWh', 'GJ', 'BTU'];
      const VOLUME_UNITS      = ['L', 'mL', 'm³', 'ft³', 'gal', 'fl. oz.', 'CCF'];
      const MASS_UNITS        = ['g', 'kg', 'oz', 'lb'];
      const POWER_UNITS       = ['W', 'kW', 'MW'];
      const DISTANCE_UNITS    = ['mm', 'cm', 'm', 'km', 'in', 'ft', 'mi', 'yd'];
      const PRESSURE_UNITS    = ['Pa', 'hPa', 'kPa', 'bar', 'cbar', 'mbar', 'psi'];
      const TEMPERATURE_UNITS = ['°C', '°F', 'K'];

      if (ENERGY_UNITS.includes(unit))      return { energy:      unit };
      if (VOLUME_UNITS.includes(unit))      return { volume:      unit };
      if (MASS_UNITS.includes(unit))        return { mass:        unit };
      if (POWER_UNITS.includes(unit))       return { power:       unit };
      if (DISTANCE_UNITS.includes(unit))    return { distance:    unit };
      if (PRESSURE_UNITS.includes(unit))    return { pressure:    unit };
      if (TEMPERATURE_UNITS.includes(unit)) return { temperature: unit };
      return {};
    }

    // ── Utility ───────────────────────────────────────────────────────────────

    _escHtml(str) {
      return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  }

  // ─── Visual Editor ──────────────────────────────────────────────────────────

  const EDITOR_STYLES = `
    :host { display: block; }
    .editor {
      padding: 8px 16px 16px;
      display: flex;
      flex-direction: column;
    }
    .section-title {
      font-size: 0.78em;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--secondary-text-color);
      padding: 16px 0 6px;
      border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12));
      margin-bottom: 10px;
    }
    .entity-row {
      border: 1px solid var(--divider-color, rgba(0,0,0,0.12));
      border-radius: var(--ha-card-border-radius, 12px);
      margin-bottom: 8px;
      overflow: hidden;
    }
    .entity-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      cursor: pointer;
      user-select: none;
      background: var(--secondary-background-color, rgba(0,0,0,0.03));
    }
    .entity-header:hover {
      background: rgba(var(--rgb-primary-text-color,33,33,33), 0.05);
    }
    .color-dot {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      flex-shrink: 0;
      border: 1px solid rgba(0,0,0,0.15);
    }
    .entity-label {
      flex: 1;
      font-size: 0.9em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--primary-text-color);
    }
    .row-actions { display: flex; gap: 2px; flex-shrink: 0; }
    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 50%;
      background: none;
      color: var(--secondary-text-color);
      cursor: pointer;
      padding: 0;
      transition: background 0.15s, color 0.15s;
    }
    .icon-btn:hover { background: rgba(var(--rgb-primary-text-color,33,33,33),0.08); color: var(--primary-text-color); }
    .icon-btn.delete:hover { background: rgba(var(--rgb-error-color,219,68,55),0.1); color: var(--error-color,#db4437); }
    .icon-btn.disabled-btn { opacity: 0.3; pointer-events: none; }
    .entity-form {
      padding: 8px 12px 12px;
      display: flex;
      flex-direction: column;
      gap: 0;
      border-top: 1px solid var(--divider-color);
    }
    .entity-form.hidden { display: none; }
    .add-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      padding: 11px;
      margin-top: 4px;
      border: 2px dashed var(--divider-color, rgba(0,0,0,0.15));
      border-radius: var(--ha-card-border-radius, 12px);
      background: none;
      color: var(--primary-color, #009ac7);
      cursor: pointer;
      font-size: 0.9em;
      font-family: inherit;
      font-weight: 500;
      transition: background 0.15s, border-color 0.15s;
    }
    .add-btn:hover {
      background: rgba(var(--rgb-primary-color,0,154,199), 0.07);
      border-color: var(--primary-color);
    }
  `;

  class CustomEnergyChartCardEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._config      = {};
      this._hass        = null;
      this._expandedIdx = null;
      this._initialized = false;
    }

    setConfig(config) {
      this._config = JSON.parse(JSON.stringify(config));
      if (!Array.isArray(this._config.entities)) this._config.entities = [];
      if (this._initialized) {
        this._syncGeneralForm();
        this._renderEntityList();
      } else {
        this._renderFull();
        this._initialized = true;
      }
    }

    set hass(hass) {
      this._hass = hass;
      // Propagate hass to all HA form components in the shadow DOM
      this.shadowRoot.querySelectorAll('ha-form').forEach(el => {
        el.hass = hass;
      });
    }

    _fire() {
      this.dispatchEvent(new CustomEvent('config-changed', {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      }));
    }

    _renderFull() {
      this.shadowRoot.innerHTML = `
        <style>${EDITOR_STYLES}</style>
        <div class="editor">
          <div class="section-title">Allgemein</div>
          <ha-form id="general-form"></ha-form>
          <div class="section-title">Entit\u00e4ten</div>
          <div id="entity-list"></div>
          <button class="add-btn" id="add-btn">
            <ha-icon icon="mdi:plus-circle-outline"></ha-icon>
            Entit\u00e4t hinzuf\u00fcgen
          </button>
        </div>
      `;

      const form = this.shadowRoot.getElementById('general-form');
      form.hass   = this._hass;
      form.schema = [
        { name: 'title',            selector: { text: {} } },
        { name: 'unit',             selector: { text: {} } },
        { name: 'refresh_interval', selector: { number: { min: 60, max: 3600, step: 60, mode: 'box' } } },
      ];
      form.computeLabel = s => ({
        title: 'Titel', unit: 'Einheit',
        refresh_interval: 'Aktualisierungsintervall (s)',
      }[s.name] || s.name);
      this._syncGeneralForm();
      form.addEventListener('value-changed', ev => {
        Object.assign(this._config, ev.detail.value);
        this._fire();
      });

      this.shadowRoot.getElementById('add-btn').addEventListener('click', () => {
        const len = this._config.entities.length;
        this._config.entities.push({
          statistic_id: '',
          name: '',
          color: DEFAULT_COLORS[len % DEFAULT_COLORS.length],
          stat_type: 'change',
        });
        this._expandedIdx = len;
        this._renderEntityList();
        this._fire();
      });

      this._renderEntityList();
    }

    _syncGeneralForm() {
      const f = this.shadowRoot.getElementById('general-form');
      if (!f) return;
      f.data = {
        title:            this._config.title            ?? '',
        unit:             this._config.unit             ?? 'kWh',
        refresh_interval: this._config.refresh_interval ?? 300,
      };
    }

    _renderEntityList() {
      const list = this.shadowRoot?.getElementById('entity-list');
      if (!list) return;
      const entities = this._config.entities;

      // Render static row shells (headers + empty form containers)
      list.innerHTML = entities.map((e, i) => {
        const exp   = this._expandedIdx === i;
        const name  = this._esc(e.name || e.statistic_id || `Entit\u00e4t ${i + 1}`);
        const color = e.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
        const n     = entities.length;
        return `
          <div class="entity-row">
            <div class="entity-header" data-i="${i}">
              <div class="color-dot" data-i="${i}" style="background:${color}"></div>
              <span class="entity-label" data-i="${i}">${name}</span>
              <div class="row-actions">
                <button class="icon-btn up${i === 0   ? ' disabled-btn' : ''}" data-i="${i}" title="Nach oben"><ha-icon icon="mdi:chevron-up"></ha-icon></button>
                <button class="icon-btn down${i===n-1 ? ' disabled-btn' : ''}" data-i="${i}" title="Nach unten"><ha-icon icon="mdi:chevron-down"></ha-icon></button>
                <button class="icon-btn delete" data-i="${i}" title="Entfernen"><ha-icon icon="mdi:delete-outline"></ha-icon></button>
              </div>
            </div>
            <div class="entity-form${exp ? '' : ' hidden'}" id="ef-${i}"></div>
          </div>
        `;
      }).join('');

      // Populate expanded entity form with a single ha-form using native HA selectors
      entities.forEach((e, i) => {
        if (this._expandedIdx !== i) return;
        const container = list.querySelector(`#ef-${i}`);
        if (!container) return;

        const form = document.createElement('ha-form');
        form.hass   = this._hass;
        form.schema = [
          { name: 'statistic_id', selector: { entity: { include_statistics: true } } },
          { name: 'name',         selector: { text: {} } },
          { name: 'color',        selector: { color_rgb: {} } },
          { name: 'stat_type',    selector: { select: { options: [
            { value: 'change', label: 'Wert\u00e4nderung (change) \u2013 Energiez\u00e4hler' },
            { value: 'mean',   label: 'Mittelwert (mean) \u2013 Leistungssensor' },
          ]}}},
        ];
        form.computeLabel = s => ({
          statistic_id: 'Entit\u00e4t / Statistik-ID',
          name:         'Anzeigename',
          color:        'Farbe',
          stat_type:    'Statistik-Typ',
        }[s.name] || s.name);
        form.data = {
          statistic_id: e.statistic_id || '',
          name:         e.name      || '',
          color:        this._hexToRgb(e.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]),
          stat_type:    e.stat_type || 'change',
        };
        form.addEventListener('value-changed', ev => {
          const v           = ev.detail.value;
          const prevStatId  = entities[i].statistic_id;
          entities[i].statistic_id = v.statistic_id || '';
          entities[i].name         = v.name || '';
          entities[i].color        = this._rgbToHex(v.color);
          entities[i].stat_type    = v.stat_type;

          // Auto-fill name from friendly_name when entity changes and name is empty
          if (v.statistic_id && v.statistic_id !== prevStatId && !v.name) {
            const friendly = this._hass?.states[v.statistic_id]?.attributes?.friendly_name;
            if (friendly) {
              entities[i].name = friendly;
              form.data = { ...form.data, name: friendly };
            }
          }

          this._updateDot(list, i, entities[i].color);
          const lbl = list.querySelector(`.entity-label[data-i="${i}"]`);
          if (lbl) lbl.textContent = v.name || v.statistic_id || `Entit\u00e4t ${i + 1}`;
          this._fire();
        });
        container.appendChild(form);
      });

      // Header expand/collapse
      list.querySelectorAll('.entity-header').forEach(hdr => {
        hdr.addEventListener('click', ev => {
          if (ev.target.closest('.icon-btn')) return;
          const i = +hdr.dataset.i;
          this._expandedIdx = this._expandedIdx === i ? null : i;
          this._renderEntityList();
        });
      });

      // Delete
      list.querySelectorAll('.icon-btn.delete').forEach(btn => {
        btn.addEventListener('click', ev => {
          ev.stopPropagation();
          const i = +btn.dataset.i;
          entities.splice(i, 1);
          if (this._expandedIdx === i)    this._expandedIdx = null;
          else if (this._expandedIdx > i) this._expandedIdx--;
          this._renderEntityList();
          this._fire();
        });
      });

      // Move up
      list.querySelectorAll('.icon-btn.up').forEach(btn => {
        btn.addEventListener('click', ev => {
          ev.stopPropagation();
          const i = +btn.dataset.i;
          if (i === 0) return;
          [entities[i-1], entities[i]] = [entities[i], entities[i-1]];
          if      (this._expandedIdx === i)   this._expandedIdx = i - 1;
          else if (this._expandedIdx === i-1) this._expandedIdx = i;
          this._renderEntityList();
          this._fire();
        });
      });

      // Move down
      list.querySelectorAll('.icon-btn.down').forEach(btn => {
        btn.addEventListener('click', ev => {
          ev.stopPropagation();
          const i = +btn.dataset.i;
          if (i >= entities.length - 1) return;
          [entities[i], entities[i+1]] = [entities[i+1], entities[i]];
          if      (this._expandedIdx === i)   this._expandedIdx = i + 1;
          else if (this._expandedIdx === i+1) this._expandedIdx = i;
          this._renderEntityList();
          this._fire();
        });
      });
    }

    _updateDot(list, i, color) {
      const dot = list.querySelector(`.color-dot[data-i="${i}"]`);
      if (dot) dot.style.background = color;
    }

    // Hex #rrggbb  →  [r, g, b]
    _hexToRgb(hex) {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
      return m ? [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)] : [72,143,194];
    }

    // [r, g, b]  →  #rrggbb
    _rgbToHex(rgb) {
      if (!Array.isArray(rgb) || rgb.length < 3) return '#488fc2';
      return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2,'0')).join('');
    }

    _esc(s) {
      return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
  }

  // ─── Registration ───────────────────────────────────────────────────────────

  if (!customElements.get('custom-energy-chart-card-editor')) {
    customElements.define('custom-energy-chart-card-editor', CustomEnergyChartCardEditor);
  }

  if (!customElements.get('custom-energy-chart-card')) {
    customElements.define('custom-energy-chart-card', CustomEnergyChartCard);
    console.info(
      `%c  CUSTOM-ENERGY-CHART-CARD  %c v${VERSION} `,
      'background:#162032;color:#7dbff5;font-weight:700;padding:3px 0',
      'background:#0d1a26;color:#aaa;padding:3px 4px'
    );
  }

  window.customCards = window.customCards || [];
  if (!window.customCards.find(c => c.type === 'custom-energy-chart-card')) {
    window.customCards.push({
      type:        'custom-energy-chart-card',
      name:        'Custom Energy Chart Card',
      description: 'Energieverbrauch-Diagramm (ähnlich dem nativen HA-Energie-Dashboard)',
      preview:     true,
    });
  }
})();
