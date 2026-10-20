"""Original, royalty-free score for the 15 s Lumi ad, built like an Apple spot: intimate to soaring.

80 BPM, one 4-beat bar (3.0 s) per shot, so the picture cuts land on downbeats.
  Bar 1  C(add9)  felt piano motif alone in a big room           (lithophane lights up)
  Bar 2  Am7      a muted synth pulse and warm sub join           (Lumi app)
  Bar 3  F(add9)  heartbeat kick, soft claps, strings rise        (full 3D)
  Bar 4  Gsus4-G  four-on-the-floor build, riser, a breath of silence  (lamp)
  Bar 5  C        the hit: wide chord, low boom, shimmer, long tail    (logo)
Usage: python build/ad/music.py <out.wav>
"""
import sys
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt
from scipy.io import wavfile

SR, DUR, BPM = 48000, 15.0, 80
N = int(SR * DUR); BEAT = 60 / BPM; BAR = 4 * BEAT
rng = np.random.default_rng(11)

def hz(note):
    names = {'C': 0, 'C#': 1, 'D': 2, 'Eb': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'Ab': 8, 'A': 9, 'Bb': 10, 'B': 11}
    return 440.0 * 2 ** ((names[note[:-1]] + 12 * (int(note[-1]) + 1) - 69) / 12)

def tt(sec): return np.arange(int(SR * sec)) / SR
def lp(x, fc, order=2): return sosfilt(butter(order, fc, 'low', fs=SR, output='sos'), x, axis=0)
def hp(x, fc, order=2): return sosfilt(butter(order, fc, 'high', fs=SR, output='sos'), x, axis=0)

# separate buses so the reverb and the ducking can treat them differently
buses = {k: np.zeros((N, 2)) for k in ('piano', 'pad', 'pulse', 'drums', 'fx', 'sub')}
def add(bus, start, sig, pan=0.0, gain=1.0):
    i = int(round(start * SR)); j = min(N, i + len(sig))
    if j <= i or i < 0: return
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buses[bus][i:j, 0] += sig[: j - i] * l * gain; buses[bus][i:j, 1] += sig[: j - i] * r * gain

# ---------------------------------------------------------------- instruments
def piano(f, vel=0.5, length=4.5):
    t = tt(length); s = np.zeros_like(t)
    for k, a in enumerate([1.0, 0.5, 0.28, 0.16, 0.09, 0.05, 0.03], start=1):
        fk = f * k * (1 + 0.00035 * k * k)
        decay = 0.55 + 0.45 * k + f / 900
        s += a * np.sin(2 * np.pi * fk * t + rng.uniform(0, 6.28)) * np.exp(-t * decay)
    s += 0.25 * np.sin(2 * np.pi * f * 1.002 * t) * np.exp(-t * 0.7)   # second string, slow beating
    s *= 1 - np.exp(-t * 140)                                             # felt hammer
    s += 0.015 * lp(rng.standard_normal(len(t)), 2500) * np.exp(-t * 60)
    return s * vel

def strings(freqs, length, attack, release=1.5):
    t = tt(length); s = np.zeros_like(t)
    for f in freqs:
        for det in (-0.09, -0.03, 0.03, 0.09):
            ff = f * 2 ** (det / 12) * (1 + 0.002 * np.sin(2 * np.pi * 5.2 * t + rng.uniform(0, 6)))  # vibrato
            ph = np.cumsum(2 * np.pi * ff / SR)
            s += sum(np.sin(k * ph) / k for k in range(1, 9))
    env = np.clip(t / attack, 0, 1) ** 1.6 * np.clip((length - t) / release, 0, 1)
    return lp(s, 2200) * env / (len(freqs) * 4)

def pluck(f, vel, cutoff):
    t = tt(0.6)
    s = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 10))
    s = lp(s, cutoff) * np.exp(-t * 9) * (1 - np.exp(-t * 400))
    return s * vel

def sub(f, length, vel):
    t = tt(length)
    return (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)) * vel * np.clip(t / 0.05, 0, 1) * np.clip((length - t) / 0.3, 0, 1)

def kick(vel=1.0):
    t = tt(0.55); f = 45 + 85 * np.exp(-t * 28)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)
    s += 0.25 * lp(rng.standard_normal(len(t)), 3000) * np.exp(-t * 120)
    return s * vel

def clap(vel=0.5):
    t = tt(0.4); n = rng.standard_normal(len(t))
    env = sum(np.exp(-np.clip(t - d, 0, None) * 140) * (t >= d) for d in (0, 0.011, 0.022)) + 0.6 * np.exp(-t * 18)
    return hp(lp(n, 6000), 900) * env * vel

def shaker(vel=0.12):
    t = tt(0.12)
    return hp(rng.standard_normal(len(t)), 6000) * np.exp(-t * 45) * vel

def bell(f, vel=0.2, length=3.5):
    t = tt(length)
    s = np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 3.0 * t) * np.exp(-t * 4) + 0.12 * np.sin(2 * np.pi * f * 4.07 * t) * np.exp(-t * 7)
    return s * np.exp(-t * 1.3) * (1 - np.exp(-t * 400)) * vel

# ---------------------------------------------------------------- arrangement
b = lambda bar, beat=0.0: bar * BAR + beat * BEAT          # time of (bar, beat), 0-based
CH = [  # (root for sub, pad voicing, piano voicing)
    ('C2', ['C3', 'G3', 'D4', 'E4'], ['C4', 'G4', 'D5', 'E5']),
    ('A1', ['A2', 'E3', 'G3', 'C4'], ['A3', 'E4', 'G4', 'C5']),
    ('F1', ['F2', 'C3', 'G3', 'A3'], ['F3', 'C4', 'G4', 'A4']),
    ('G1', ['G2', 'D3', 'G3', 'C4'], ['G3', 'D4', 'G4', 'C5']),   # sus4, resolves on beat 3
    ('C2', ['C3', 'G3', 'E4', 'G4', 'D5'], ['C3', 'G3', 'C4', 'E4', 'G4', 'D5']),
]
MOTIF = [  # felt piano melody: (bar, beat, note, vel)
    (0, 0.0, 'E5', 0.30), (0, 1.5, 'D5', 0.22), (0, 2.0, 'C5', 0.24), (0, 3.0, 'G4', 0.22),
    (1, 0.0, 'E5', 0.28), (1, 1.5, 'D5', 0.20), (1, 2.0, 'C5', 0.22), (1, 3.0, 'E5', 0.24),
    (2, 0.0, 'F5', 0.30), (2, 1.5, 'E5', 0.22), (2, 2.0, 'C5', 0.24), (2, 3.0, 'A4', 0.22),
    (3, 0.0, 'G5', 0.32), (3, 1.5, 'F5', 0.24), (3, 2.0, 'E5', 0.26), (3, 2.5, 'D5', 0.26),
]
for bar, beat, n, v in MOTIF:
    add('piano', b(bar, beat), piano(hz(n), v), pan=0.15)

for i, (root, pad, pv) in enumerate(CH[:4]):
    # soft chord under the motif
    for k, n in enumerate(pv[:3]):
        add('piano', b(i) + 0.02 * k, piano(hz(n), 0.16 + 0.03 * i), pan=-0.3 + 0.2 * k)
    # strings enter in bar 2 and climb in loudness
    if i >= 1:
        add('pad', b(i) - 0.4, strings([hz(n) for n in pad], BAR + 0.9, attack=1.6 if i == 1 else 0.6), gain=0.5 + 0.25 * i)
    if i >= 1:
        add('sub', b(i), sub(hz(root), BAR if i < 3 else BAR - BEAT * 0.5, 0.42))
# sus4 -> major: lift the C to B on beat 3 of bar 4
add('pad', b(3, 2), strings([hz('B3')], BAR / 2, attack=0.25, release=0.3), gain=1.0)

# pulse: muted synth eighths from bar 2, opening its filter as the build rises
for bar in (1, 2, 3):
    tones = CH[bar][2]
    for e in range(8):
        if bar == 3 and e >= 7: continue                    # leave the breath before the hit
        cutoff = 900 + 3200 * ((bar - 1) * 8 + e) / 24
        add('pulse', b(bar, e / 2), pluck(hz(tones[e % 2 + 1]) , 0.22 + 0.04 * (e % 2 == 0), cutoff), pan=0.35 if e % 2 else -0.35)

# drums: heartbeat in bar 3, four-on-the-floor build in bar 4
for beat, v in [(0, 0.9), (1.75, 0.45), (2, 0.8)]:
    add('drums', b(2, beat), kick(v))
for beat in (1, 3):
    add('drums', b(2, beat), clap(0.35), pan=0.05)
for beat in range(4):
    add('drums', b(3, beat), kick(0.95))
    if beat in (1, 3): add('drums', b(3, beat), clap(0.45))
for e in range(14):
    add('drums', b(3, e / 4 + 0.0) + 0.0, shaker(0.05 + 0.006 * e), pan=0.4)

# riser into the hit, then a breath of silence
t = tt(BAR); noise = hp(rng.standard_normal(len(t)), 1500)
sw = np.clip(t / BAR, 0, 1) ** 2.2
riser = noise * sw * 0.22 + 0.10 * np.sin(2 * np.pi * np.cumsum(220 + 660 * sw) / SR) * sw
riser[int(SR * (BAR - 0.16)):] = 0
add('fx', b(3), riser)
# reverse cymbal swell into bar 2 (the app shot)
t = tt(1.4); rc = hp(rng.standard_normal(len(t)), 4000) * (t / 1.4) ** 3 * 0.12
add('fx', b(1) - 1.4, rc)

# the hit: low boom, wide chord, shimmer
t = tt(3.0)
boom = np.sin(2 * np.pi * np.cumsum(38 + 40 * np.exp(-t * 6)) / SR) * np.exp(-t * 1.6) * 0.9
add('sub', b(4), boom)
add('drums', b(4), kick(1.0))
for k, n in enumerate(CH[4][2]):
    add('piano', b(4) + 0.012 * k, piano(hz(n), 0.36, 3.0), pan=-0.5 + 0.2 * k)
add('pad', b(4), strings([hz(n) for n in CH[4][1]], 3.0, attack=0.05, release=1.6), gain=1.5)
add('sub', b(4), sub(hz('C1') * 2, 2.8, 0.35))
for when, n, v in [(0.0, 'G5', 0.16), (0.5, 'C6', 0.14), (1.0, 'D6', 0.12), (1.5, 'E6', 0.12), (2.25, 'G6', 0.08)]:
    add('fx', b(4, when), bell(hz(n), v), pan=0.4 - 0.2 * when)

# ---------------------------------------------------------------- mix
def reverb(x, seconds, damp, predelay=0.025):
    """Hall reverb whose output keeps the input's loudness (so quiet sends stay quiet)."""
    n = int(SR * seconds); t = np.arange(n) / SR
    ir = rng.standard_normal((n, 2)) * np.exp(-t * (6.9 / seconds))[:, None]
    ir = lp(ir, damp); ir[: int(SR * predelay)] = 0
    y = np.stack([fftconvolve(x[:, c], ir[:, c])[:N] for c in range(2)], 1)
    rx, ry = np.sqrt((x ** 2).mean()) + 1e-12, np.sqrt((y ** 2).mean()) + 1e-12
    return y * (rx / ry)

g = {'piano': 1.0, 'pad': 0.55, 'pulse': 0.55, 'drums': 0.45, 'fx': 0.55, 'sub': 0.7}
wet = {'piano': (0.85, 3.8, 4500), 'pad': (0.5, 3.0, 3000), 'pulse': (0.35, 1.6, 5000), 'drums': (0.15, 1.2, 6000), 'fx': (0.6, 3.5, 7000), 'sub': (0.0, 1, 1)}
mix = np.zeros((N, 2))
# sidechain: pad and pulse dip on each kick, for that gentle pumping lift
duck = np.ones(N)
for start in [b(2, 0), b(2, 1.75), b(2, 2)] + [b(3, k) for k in range(4)] + [b(4)]:
    i = int(start * SR); n = int(0.35 * SR); env = 1 - 0.35 * np.exp(-np.arange(n) / (0.09 * SR))
    j = min(N, i + n); duck[i:j] = np.minimum(duck[i:j], env[: j - i])
for k, x in buses.items():
    x = x * g[k]
    if k in ('pad', 'pulse'): x = x * duck[:, None]
    if k == 'sub': x = lp(x, 180)
    mix += x
    if wet[k][0]: mix += wet[k][0] * reverb(x, wet[k][1], wet[k][2])

# arrangement arc: intimate -> rising -> breath -> hit
t_all = np.arange(N) / SR
arc = np.interp(t_all, [0, 2.9, 3.0, 5.9, 6.0, 8.9, 9.0, 11.80, 11.84, 11.985, 12.0, 15.0],
                       [0.55, 0.6, 0.66, 0.72, 0.8, 0.86, 0.9, 1.0, 0.0, 0.0, 1.15, 1.15])
mix *= arc[:, None]
env = np.clip(t_all / 0.5, 0, 1) * np.clip((DUR - t_all) / 1.6, 0, 1) ** 1.3
mix *= env[:, None]
mix = np.tanh(mix * 1.25) / np.tanh(1.25)
mix *= 10 ** (-1.0 / 20) / np.abs(mix).max()
wavfile.write(sys.argv[1], SR, (mix * 32767).astype(np.int16))
print('wrote', sys.argv[1])
