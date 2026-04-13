---
feature_ids: []
topics: [piano, web-audio, teaching-app, desktop, guided-practice]
doc_kind: design
created: 2026-04-13
status: approved
---

# Piano Teaching App — Design Spec

## 1. Overview

**Type**: Single-file Web Piano Teaching App Prototype
**Stack**: Pure HTML + CSS + JavaScript (no build tools)
**Audio**: Web Audio API Oscillator (triangle wave)
**Target Users**: Beginners wanting guided piano practice on desktop
**Platform**: Desktop browser (single HTML file, can be wrapped in Electron later)

---

## 2. Core Features

| Feature | Description |
|---------|-------------|
| **Virtual Keyboard** | 2 octaves (C3–B4), white + black keys, mouse/touch support |
| **Guided Highlighting** | Current target key highlighted, waiting for user input |
| **BPM-driven Progress** | Next note highlighted after correct press |
| **Built-in Song Library** | 3–5 beginner songs (Twinkle Twinkle, Mary Had a Little Lamb, etc.) |
| **Audio Feedback** | Key press sound (triangle wave), correct/wrong feedback |
| **Progress Indicator** | Shows current note index and total notes |

---

## 3. Song Library Format

```json
{
  "songs": [
    {
      "name": "小星星",
      "bpm": 120,
      "notes": [
        { "note": 60, "duration": 0.5 },
        { "note": 60, "duration": 0.5 },
        { "note": 67, "duration": 0.5 }
      ]
    },
    {
      "name": "玛丽有只小羊羔",
      "bpm": 100,
      "notes": [
        { "note": 64, "duration": 0.5 },
        { "note": 62, "duration": 0.5 }
      ]
    }
  ]
}
```

MIDI note mapping: C3=48, C#3=49, D3=50 ... B4=71

---

## 4. Interaction Flow

1. User opens HTML → "Click to Start" overlay (activates AudioContext per browser policy)
2. Click → Song selection screen (list of available songs)
3. Select song → Display keyboard with first key highlighted
4. User presses correct key → Play note sound + highlight next key
5. User presses wrong key → Red flash + stay on current key
6. Song complete → Show "Completed!" message

---

## 5. Keyboard Layout

| Key Type | Size | Computer Keyboard Mapping |
|----------|------|--------------------------|
| White keys | 48px × 180px | A=C3, S=D3, D=E3, F=F3, G=G3, H=A3, J=B3, K=C4 |
| Black keys | 28px × 110px | W=C#3, E=D#3, T=F#3, Y=G#3, U=A#3 |

---

## 6. Audio Engine

### 6.1 Synthesis Chain

```
OscillatorNode (triangle wave)
  → GainNode (ADSR envelope)
    → AudioContext.destination
```

### 6.2 ADSR Envelope

| Stage | Value |
|-------|-------|
| Attack | 10ms |
| Decay | 100ms |
| Sustain | 0.7 |
| Release | 300ms |

### 6.3 Frequency Calculation

```
frequency = 440 × 2^((midiNote - 69) / 12)
```

### 6.4 Polyphony

Maximum 10 simultaneous voices.

---

## 7. Visual States

| State | Visual |
|-------|--------|
| Default | White key = white, Black key = dark |
| Highlighted (next note) | Cyan/blue glow + pulsing animation |
| Pressed (correct) | Brief green flash |
| Pressed (wrong) | Brief red flash |

---

## 8. File Structure

```
piano-teaching-app.html   # Single self-contained file
```

---

## 9. Initial Song List

| Song | BPM | Difficulty |
|------|-----|------------|
| 小星星 (Twinkle Twinkle) | 120 | ★☆☆ |
| 玛丽有只小羊羔 (Mary Had a Little Lamb) | 100 | ★☆☆ |
| 生日快乐 (Happy Birthday) | 110 | ★★☆ |

---

## 10. Out of Scope (This Version)

- MIDI device input
- Recording/playback
- Multiple timbres
- Sheet music display
- Progress tracking/statistics
-课程编辑器
-移动端 native apps

---

## 11. Future Extension Points

- Add sound presets (sine, square, sawtooth)
- Add metronome mode
- Add MIDI device support
- Add recording feature
- Expand song library
- Add progress tracking
- Wrap in Electron for desktop distribution
