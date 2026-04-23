# Custom Energy Chart Card

A custom Lovelace card for Home Assistant that displays energy consumption as stacked bar charts — similar to the native HA Energy Dashboard.

![Preview](preview.png)

## Features

- **Stacked bar charts** — visualize multiple energy sources per time slot
- **Period selector** — Tag / Woche / Monat (Day / Week / Month)
- **Hover tooltips** — detailed breakdown per time slot
- **Total consumption chip** — live kWh sum in the card header
- **Responsive** — adapts to any card width via ResizeObserver
- **Theme-aware** — uses HA CSS custom properties for light/dark mode
- **Auto-refresh** — configurable refresh interval (default 5 minutes)
- **Zero dependencies** — no external libraries, pure Canvas 2D

---

## Installation via HACS

1. Open HACS → **Frontend**
2. Click the three-dot menu → **Custom repositories**
3. Add `https://github.com/YOUR_USER/custom-energy-chart-card` as type **Lovelace**
4. Search for **Custom Energy Chart Card** and install it
5. **Hard-refresh** your browser (Ctrl+Shift+R / Cmd+Shift+R)

> HACS automatically registers the resource in Lovelace. No manual `configuration.yaml` change needed.

### Manual installation (without HACS)

1. Copy `custom-energy-chart-card.js` to `<config>/www/custom-energy-chart-card.js`
2. Add the resource in **Settings → Dashboards → Resources**:
   ```
   URL:  /local/custom-energy-chart-card.js
   Type: JavaScript Module
   ```

---

## Configuration

```yaml
type: custom:custom-energy-chart-card
title: Stromnutzung
period: day          # day | week | month  (default: day)
unit: kWh            # display unit        (default: kWh)
chart_height: 250    # chart area height   (default: 250)
refresh_interval: 300  # auto-refresh in s (default: 300)
entities:
  - entity: sensor.energy_building_441
    name: Gebäude 441 Gesamt
    color: "#7dbff5"
  - entity: sensor.energy_building_439
    name: Gebäude 439 Gesamt
    color: "#488fc2"
  - entity: sensor.pv_self_consumption
    name: PV-Eigenverbrauch
    color: "#ff9800"
    stat_type: change   # change | mean  (default: change)
```

### Entity options

| Option        | Type   | Default    | Description |
|---------------|--------|------------|-------------|
| `entity`      | string | *required* | Entity ID or statistic ID |
| `name`        | string | entity ID  | Display name shown in legend and tooltip |
| `color`       | string | auto       | Bar color (CSS color string) |
| `stat_type`   | string | `change`   | `change` for energy sensors (total_increasing), `mean` for power sensors |

### Card options

| Option             | Type    | Default | Description |
|--------------------|---------|---------|-------------|
| `title`            | string  | `Energy Usage` | Card header title |
| `unit`             | string  | `kWh`   | Unit displayed in axes and tooltip |
| `period`           | string  | `day`   | Initial period: `day`, `week`, or `month` |
| `chart_height`     | number  | `250`   | Minimum chart area height in pixels |
| `refresh_interval` | number  | `300`   | How often to refresh statistics (seconds) |

---

## Requirements

- Home Assistant **2022.11.0** or newer (uses `recorder/statistics_during_period` WebSocket API)
- Entities must have **long-term statistics** enabled (sensor with `state_class: total_increasing` or `measurement`)

### Enabling long-term statistics

In your sensor configuration:
```yaml
sensor:
  - platform: template
    sensors:
      energy_building_441:
        unit_of_measurement: kWh
        device_class: energy
        state_class: total_increasing
        value_template: "{{ states('sensor.your_raw_sensor') }}"
```

---

## Default colors

If no `color` is specified, entities are assigned colors in this order:

| # | Hex       | Preview |
|---|-----------|---------|
| 1 | `#488fc2` | Blue |
| 2 | `#7dbff5` | Light blue |
| 3 | `#ff9800` | Orange |
| 4 | `#4db6ac` | Teal |
| 5 | `#f06292` | Pink |
| 6 | `#8353d1` | Purple |
| 7 | `#43a047` | Green |
| 8 | `#e53935` | Red |

---

## Troubleshooting

**"Fehler: Statistiken nicht verfügbar"**
- The entity has no long-term statistics. Check `state_class` in entity configuration.
- Statistics are only built from the moment `state_class` is set — older data won't appear.

**Chart shows zeros for all bars**
- Statistics may not yet exist for today. Try switching to **Woche** (week) to see historical data.

**Card not visible in card picker**
- Ensure the resource was loaded. Hard-refresh the browser after installation.

---

## License

MIT © 2024
