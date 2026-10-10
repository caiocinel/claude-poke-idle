"""Drive an interactive Claude Code session with the mod in a pseudo-terminal and
screenshot the screen as text and PNG. Usage:

  _venv/Scripts/python tools/drive.py <out_prefix> <steps.json>

steps.json is a list of ["wait", seconds] | ["type", text] | ["key", name] | ["shot", name].
"""
import json, os, sys, time, threading
import pyte
from winpty import PtyProcess
from PIL import Image, ImageDraw, ImageFont

COLS, ROWS = 150, 60
KEYS = {'enter': '\r', 'esc': '\x1b', 'tab': '\t', 'down': '\x1b[B', 'up': '\x1b[A', 'ctrlx': '\x18', 'ctrlc': '\x03'}

out, steps = sys.argv[1], json.load(open(sys.argv[2], encoding='utf-8'))
screen = pyte.Screen(COLS, ROWS)
stream = pyte.Stream(screen)
env = dict(os.environ)
env['TERM'] = 'xterm-256color'
env['COLORTERM'] = 'truecolor'
for kv in os.environ.get('DRIVE_ENV', '').split(','):
    if '=' in kv:
        k, v = kv.split('=', 1)
        env[k] = v
plugin = os.path.abspath('pokeidle')
proc = PtyProcess.spawn(['claude', '--plugin-dir', plugin], dimensions=(ROWS, COLS), env=env, cwd=os.path.abspath('_sandbox'))
lock = threading.Lock()


def reader():
    while True:
        try:
            data = proc.read(65536)
        except Exception:
            return
        with lock:
            stream.feed(data)


threading.Thread(target=reader, daemon=True).start()

NAMED = {'black': (0, 0, 0), 'red': (205, 49, 49), 'green': (13, 188, 121), 'brown': (229, 229, 16), 'yellow': (229, 229, 16),
         'blue': (36, 114, 200), 'magenta': (188, 63, 188), 'cyan': (17, 168, 205), 'white': (229, 229, 229), 'default': None}


def color(c, fallback):
    if c in NAMED:
        return NAMED[c] or fallback
    if isinstance(c, str) and len(c) == 6:
        try:
            return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
        except ValueError:
            pass
    return fallback


def shot(name):
    with lock:
        lines = [''.join(screen.buffer[y][x].data for x in range(COLS)) for y in range(ROWS)]
        cells = [[screen.buffer[y][x] for x in range(COLS)] for y in range(ROWS)]
    open(f'{out}-{name}.txt', 'w', encoding='utf-8').write('\n'.join(l.rstrip() for l in lines))
    cw, ch = 8, 16
    img = Image.new('RGB', (COLS * cw, ROWS * ch), (24, 24, 24))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype('consola.ttf', 14)
    except OSError:
        font = ImageFont.load_default()
    for y, row in enumerate(cells):
        for x, c in enumerate(row):
            fg = color(c.fg, (220, 220, 220))
            bg = color(c.bg, (24, 24, 24))
            if c.reverse:
                fg, bg = bg, fg
            ch_ = c.data
            x0, y0 = x * cw, y * ch
            if ch_ == '▀':
                d.rectangle([x0, y0, x0 + cw - 1, y0 + ch // 2 - 1], fill=fg)
                d.rectangle([x0, y0 + ch // 2, x0 + cw - 1, y0 + ch - 1], fill=bg)
            elif ch_ == '▄':
                d.rectangle([x0, y0, x0 + cw - 1, y0 + ch // 2 - 1], fill=bg)
                d.rectangle([x0, y0 + ch // 2, x0 + cw - 1, y0 + ch - 1], fill=fg)
            elif ch_ == '█':
                d.rectangle([x0, y0, x0 + cw - 1, y0 + ch - 1], fill=fg)
            else:
                if bg != (24, 24, 24):
                    d.rectangle([x0, y0, x0 + cw - 1, y0 + ch - 1], fill=bg)
                if ch_.strip():
                    d.text((x0, y0), ch_, fill=fg, font=font)
    img.save(f'{out}-{name}.png')


for kind, arg in steps:
    if kind == 'wait':
        time.sleep(arg)
    elif kind == 'type':
        for c in arg:
            proc.write(c)
            time.sleep(0.03)
    elif kind == 'key':
        proc.write(KEYS[arg])
    elif kind == 'shot':
        shot(arg)
proc.write('\x03')
time.sleep(0.5)
proc.write('\x03')
time.sleep(1)
proc.terminate(force=True)
