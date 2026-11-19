# Seeded generator for a tileable multicam-style pattern: brushy elongated shapes in a few
# close tones, plus thin branch strokes on top. Prints a CSS url("data:...") value.
import math, random, sys, urllib.parse
W = 400
def shape(rng, cx, cy, size, angle):
    n = rng.randint(14, 20); pts = []
    for i in range(n):
        a = 2*math.pi*i/n + rng.uniform(-.25,.25)
        r = size*(rng.uniform(.6, 1.0) if i % 3 else rng.uniform(.35, .7))
        x, y = math.cos(a)*r*1.9, math.sin(a)*r*.75   # elongated
        ca, sa = math.cos(angle), math.sin(angle)
        pts.append((cx + x*ca - y*sa, cy + x*sa + y*ca))
    return pts
def branch(rng, x, y, angle, length, depth):
    segs = []; pts=[(x,y)]
    for _ in range(rng.randint(3,5)):
        angle += rng.uniform(-.5,.5); step = length/4
        x += math.cos(angle)*step; y += math.sin(angle)*step; pts.append((x,y))
        if depth and rng.random() < .45:
            segs += branch(rng, x, y, angle + rng.choice([-1,1])*rng.uniform(.6,1.1), length*.5, depth-1)
    return [pts] + segs
def wrapped(pts):
    out=[]
    for dx in (-W,0,W):
        for dy in (-W,0,W):
            q=[(x+dx,y+dy) for x,y in pts]
            if max(x for x,_ in q) > 0 and min(x for x,_ in q) < W and max(y for _,y in q) > 0 and min(y for _,y in q) < W: out.append(q)
    return out
def path(pts, close=True):
    # smooth-ish brushy outline with quadratic midpoints
    s = 'M%.0f %.0f' % pts[0]
    for i in range(1, len(pts)): s += 'L%.0f %.0f' % pts[i]
    return s + ('Z' if close else '')
def gen(seed, tones, twig, speck):
    rng = random.Random(seed); body=[]
    for tone, grid, size in tones:
        cell = W / grid; d = ''
        for gx in range(grid):
            for gy in range(grid):
                cx = (gx + rng.uniform(0, 1)) * cell; cy = (gy + rng.uniform(0, 1)) * cell
                for q in wrapped(shape(rng, cx, cy, size*rng.uniform(.7,1.3), rng.uniform(-.7,.7))): d += path(q)
        body.append(f"<path fill='{tone}' d='{d}'/>")
    d=''
    for _ in range(5):
        for seg in branch(rng, rng.uniform(0,W), rng.uniform(0,W), rng.uniform(-math.pi, math.pi), rng.uniform(60,100), 2):
            for q in wrapped(seg): d += path(q, False)
    body.append(f"<path fill='none' stroke='{twig}' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round' d='{d}'/>")
    d = ''.join(path(q) for _ in range(26) for q in wrapped(shape(rng, rng.uniform(0,W), rng.uniform(0,W), rng.uniform(3,7), rng.uniform(0,3))))
    body.append(f"<path fill='{speck}' d='{d}'/>")
    svg = f"<svg xmlns='http://www.w3.org/2000/svg' width='{W}' height='{W}'>{''.join(body)}</svg>"
    return 'url("data:image/svg+xml,' + urllib.parse.quote(svg, safe="/:=' ,.-") + '")'
which = sys.argv[1]
if which == 'nightop':   # multicam black: black base, charcoal/gray brush shapes, gray branches
    print(gen(7, [('#181816', 5, 34), ('#201f1c', 6, 24), ('#292824', 5, 17), ('#33322d', 4, 10)], '#36352f', '#060606'))
else:                     # field manual: flat dark earth / coyote tones, very low contrast
    print(gen(11, [('#2a2418', 5, 34), ('#332b1d', 6, 24), ('#3d3322', 5, 17), ('#473b27', 4, 10)], '#4a3e2a', '#17130c'))
