---
feature_ids: []
topics: [piano, web-audio, simulator]
doc_kind: design
created: 2026-04-13
status: approved
---

# Web Piano Keyboard Simulator — Design Spec

## 1. Overview

**Type**: Single-file Web Piano Keyboard Simulator
**Stack**: Pure HTML + CSS + JavaScript (no build tools)
**Audio**: Web Audio API Oscillator (triangle wave)
**Target Users**: Lightweight users wanting a quick piano experience in-browser

---

## 2. UI Layout

- **Keyboard**: 2 octaves, C3 → B4 (14 white keys, 10 black keys)
- **White keys**: 40px wide × 160px tall, arranged horizontally
- **Black keys**: 24px wide × 100px tall, absolutely positioned over white keys
- **Computer keyboard mapping**: A–L row = white keys, W/U/E/R/T/Y/U = black keys (standard piano teaching layout)
- **Volume slider**: Optional, positioned above the keyboard
- **Responsive**: Portrait mobile shows vertical scroll; landscape mobile / desktop shows full keyboard

---

## 3. Audio Engine

### 3.1 Synthesis Chain

```
OscillatorNode (triangle wave)
  → GainNode (ADSR envelope)
    → AudioContext.destination
```

### 3.2 ADSR Envelope

| Stage | Value |
|-------|-------|
| Attack | 10ms |
| Decay | 100ms |
| Sustain | 0.7 |
| Release | 300ms |

### 3.3 Frequency Calculation

```
frequency = 440 × 2^((midiNote - 69) / 12)
```

MIDI note range: C3 = 48, B4 = 71

### 3.4 Polyphony

Maximum 10 simultaneous voices to prevent mobile performance degradation.

---

## 4. Interaction

| Input | Action |
|-------|--------|
| Mouse down on key | noteOn(key) + visual press state |
| Mouse up on key | noteOff(key) + restore visual state |
| Touch start on key | noteOn(key) + visual press state |
| Touch end on key | noteOff(key) + restore visual state |
| Keyboard key (A–L, W/U/E/R/T/Y) | Play corresponding note |

---

## 5. AudioContext Lifecycle

AudioContext is created lazily on first user interaction (browser autoplay policy). A "Click to start" overlay is shown until first interaction.

---

## 6. File Structure

```
piano.html   # Single self-contained file (HTML + CSS + JS embedded)
```

---

## 7. Future Extension Points

- Add sound presets (sine, square, sawtooth) via UI toggle
- Add reverb via ConvolverNode
- Expand to 3 octaves
- Add MIDI device input via Web MIDI API
- Add recording/playback via MediaRecorder

These can be added without changing the core architecture.

---

## 8. Out of Scope (This Version)

- MIDI input
- Recording/playback
- Multiple timbres
- Sheet music display
- Lesson content
- Mobile native apps
