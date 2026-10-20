"""Cuts the 15 s Lumi ad (1920x1080, 30 fps) from the Blender shots, the app footage and an end card.

Usage: python build/ad/compose.py <ad_dir> <out.mp4>
<ad_dir> holds litho/, bust/, lamp/ (Blender PNG frames from ad.py) and app/ (record-app.js output).
Needs Pillow and ffmpeg on PATH.
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

AD, OUT = sys.argv[1], sys.argv[2]
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
W, H, FPS = 1920, 1080, 30
FRAMES_DIR = os.path.join(AD, 'frames'); os.makedirs(FRAMES_DIR, exist_ok=True)

def font(size, weight='Semibold Display'):
    try:
        f = ImageFont.truetype('C:/Windows/Fonts/SegUIVar.ttf', size)
        f.set_variation_by_name(weight)
        return f
    except Exception:
        return ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf', size)

def ease(t): t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)

# ---------------------------------------------------------------- sources
def blender(shot):
    d = os.path.join(AD, shot)
    files = sorted(f for f in os.listdir(d) if f.endswith('.png') and not f.startswith('test'))
    return [os.path.join(d, f) for f in files]

shots = {k: blender(k) if os.path.isdir(os.path.join(AD, k)) else [] for k in ('litho', 'bust', 'lamp')}
ONLY = [int(x) for x in os.environ.get('ONLY', '').split(',') if x]  # proof specific frames, skip encoding
app_frames = json.load(open(os.path.join(AD, 'app', 'frames.json')))

def app_at(t_src):
    best = min(app_frames, key=lambda x: abs(x['t'] - t_src))
    return Image.open(os.path.join(AD, 'app', best['f'])).convert('RGB')

# rounded-corner mask + shadow for the floating app window
APP_W = 1500; APP_H = int(APP_W * 1000 / 1600)
mask = Image.new('L', (APP_W, APP_H), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, APP_W - 1, APP_H - 1), 22, fill=255)
shadow = Image.new('L', (APP_W + 200, APP_H + 200), 0)
ImageDraw.Draw(shadow).rounded_rectangle((100, 120, APP_W + 100, APP_H + 120), 30, fill=150)
shadow = shadow.filter(ImageFilter.GaussianBlur(40))

def app_scene(local_t, dur):
    p = local_t / dur
    src_t = 0.15 + p * 4.55                         # 4.8 s of footage played over ~3 s
    win = app_at(src_t).resize((APP_W, APP_H), Image.LANCZOS)
    s = 0.74 + 0.06 * ease(p)                       # slow push-in
    w, h = int(APP_W * s), int(APP_H * s)
    canvas = Image.new('RGB', (W, H), (0, 0, 0))
    y = 225 + int((0.8 - s) * 60)
    sh = shadow.resize((w + int(200 * s), h + int(200 * s)))
    glow = Image.new('RGB', sh.size, (30, 30, 34)); canvas.paste(glow, ((W - sh.width) // 2, y - int(100 * s)), sh)
    canvas.paste(win.resize((w, h), Image.LANCZOS), ((W - w) // 2, y), mask.resize((w, h)))
    return canvas

ICON = Image.open(os.path.join(ROOT, 'build', 'icon.png')).convert('RGBA')

def end_card(local_t):
    c = Image.new('RGB', (W, H), (0, 0, 0)); d = ImageDraw.Draw(c, 'RGBA')
    a_icon = ease(local_t / 0.6); a_name = ease((local_t - 0.25) / 0.6); a_sub = ease((local_t - 0.7) / 0.6); a_url = ease((local_t - 1.1) / 0.6)
    size = 150
    ic = ICON.resize((size, size), Image.LANCZOS); alpha = ic.getchannel('A').point(lambda v: int(v * a_icon)); ic.putalpha(alpha)
    c.paste(ic, ((W - size) // 2, 250 + int(12 * (1 - a_icon))), ic)
    def center(text, f, y, a, rgb=(245, 245, 247)):
        tw = d.textlength(text, font=f); d.text(((W - tw) / 2, y + 10 * (1 - a)), text, font=f, fill=(*rgb, int(255 * a)))
    center('Lumi', font(132, 'Semibold Display'), 430, a_name)
    center('Lithophanes and 3D models from any photo.', font(44, 'Regular'), 610, a_sub, (161, 161, 166))
    center('Free in your browser  ·  Windows app', font(38, 'Semibold Text'), 690, a_url, (255, 159, 10))
    center('chahatdeep.github.io/Lumi', font(34, 'Regular'), 760, a_url, (134, 134, 139))
    return c

# ---------------------------------------------------------------- timeline (seconds)
# (start, end, kind, arg, title, title_start)
TL = [  # one 4-beat bar (80 BPM = 3.0 s) per shot, so every cut lands on a downbeat of the score
    (0.0, 3.0, 'litho', None, 'Photos that glow.', 1.55),
    (3.0, 6.0, 'app', None, 'Any photo. Any shape.', 3.25),
    (6.0, 9.0, 'bust', None, 'One photo. Full 3D.', 6.3),
    (9.0, 12.0, 'lamp', None, 'Light, reimagined.', 9.3),
    (12.0, 15.0, 'end', None, None, None),
]
DIP = 0.12  # quick dip to black at each cut

TITLE = font(88, 'Semibold Display')
# type lives in clean negative space: centred above the app window, otherwise two lines beside the subject,
# alternating sides from shot to shot
LAYOUT = {
    'litho': ('left', ['Photos', 'that glow.']),
    'app': ('top', ['Any photo. Any shape.']),
    'bust': ('right', ['One photo.', 'Full 3D.']),
    'lamp': ('left', ['Light,', 'reimagined.']),
}
SIDE_X, LINE_H, MID_Y = 120, 100, 520

def ramp_mask(w, h, horizontal, strength, power=1.5, reverse=False):
    """Darkness mask: strongest at the left (horizontal) or top (vertical) edge, fading to 0; reverse flips it."""
    import numpy as np
    n = w if horizontal else h
    v = (1 - np.linspace(0, 1, n)) ** power * strength
    if reverse: v = v[::-1]
    arr = np.tile(v, (h, 1)) if horizontal else np.tile(v[:, None], (1, w))
    return Image.fromarray(arr.astype('uint8'), 'L')

def scrim(img, kind):
    side = LAYOUT[kind][0]
    if side == 'top':
        img.paste((0, 0, 0), (0, 0, W, 420), ramp_mask(W, 420, False, 150))
    elif kind == 'litho':  # the warm wall needs a little contrast under white type
        m = ramp_mask(900, H, True, 140) if side == 'left' else ramp_mask(900, H, True, 140, reverse=True)
        img.paste((0, 0, 0), (0, 0, 900, H) if side == 'left' else (W - 900, 0, W, H), m)
    return img

def title(img, kind, local):
    a = ease(local / 0.55)
    if a <= 0: return img
    side, lines = LAYOUT[kind]
    d = ImageDraw.Draw(img, 'RGBA'); fill = (245, 245, 247, int(255 * a)); dy = 16 * (1 - a)
    if side == 'top':
        d.text((W / 2, 74 + dy), lines[0], font=TITLE, fill=fill, anchor='mt')
        return img
    y0 = MID_Y - (len(lines) - 1) * LINE_H / 2
    for k, line in enumerate(lines):
        x, anchor = (SIDE_X, 'ls') if side == 'left' else (W - SIDE_X, 'rs')
        d.text((x, y0 + k * LINE_H + dy), line, font=TITLE, fill=fill, anchor=anchor)
    return img

N = int(15.0 * FPS)
for i in (ONLY or range(N)):
    t = i / FPS
    seg = next(s for s in TL if s[0] <= t < s[1] or (s is TL[-1]))
    start, end, kind, _, text, ts = seg
    local = t - start
    if kind in shots:
        frames = shots[kind]
        img = Image.open(frames[min(len(frames) - 1, int(local * FPS))]).convert('RGB') if frames else Image.new('RGB', (W, H), (40, 40, 40))
        if img.size != (W, H): img = img.resize((W, H), Image.LANCZOS)
    elif kind == 'app':
        img = app_scene(local, end - start)
    else:
        img = end_card(local)
    if text:
        img = scrim(img, kind)
        img = title(img, kind, t - ts)
    # dips to black at cuts, fade in at the very start
    k = 1.0
    if kind != 'end' or True:
        k = min(k, ease((t - start) / DIP) if start > 0 else ease(t / 0.35))
        if kind != 'end': k = min(k, ease((end - t) / DIP))
    if k < 1: img = Image.blend(Image.new('RGB', (W, H)), img, k)
    img.save(os.path.join(FRAMES_DIR, f'{i:04d}.png'))

if ONLY: sys.exit(0)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', os.path.join(FRAMES_DIR, '%04d.png'),
                '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT], check=True)
print('wrote', OUT)
