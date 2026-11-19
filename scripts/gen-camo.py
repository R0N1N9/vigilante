# Seeded generator for a tileable multicam-style pattern: brushy elongated shapes in a few
# close tones, plus thin branch strokes on top. Prints a CSS url("data:...") value.
import math, random, sys, urllib.parse
W = 400
def shape(rng, cx, cy, size, angle, stretch=(1.9, .75), jag=True):
    n = rng.randint(14, 20) if jag else rng.randint(11, 14); pts = []
    for i in range(n):
        a = 2*math.pi*i/n + rng.uniform(-.25,.25)
        r = size*((rng.uniform(.6, 1.0) if i % 3 else rng.uniform(.35, .7)) if jag else (rng.uniform(.6, 1.0) if i % 4 else rng.uniform(.3, .55)))
        x, y = math.cos(a)*r*stretch[0], math.sin(a)*r*stretch[1]   # elongated
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
def blob(pts):
    # smooth closed curve through the midpoints: soft, irregular splotches
    n = len(pts); mid = lambda a, b: ((a[0]+b[0])/2, (a[1]+b[1])/2)
    m0 = mid(pts[-1], pts[0]); s = 'M%.0f %.0f' % m0
    for i in range(n):
        c = pts[i]; e = mid(pts[i], pts[(i+1) % n]); s += 'Q%.0f %.0f %.0f %.0f' % (c + e)
    return s + 'Z'
def gen(seed, tones, twig, speck, splotch=False):
    rng = random.Random(seed); body=[]
    for tone, grid, size in tones:
        cell = W / grid; d = ''
        for gx in range(grid):
            for gy in range(grid):
                cx = (gx + rng.uniform(0, 1)) * cell; cy = (gy + rng.uniform(0, 1)) * cell
                pts = shape(rng, cx, cy, size*rng.uniform(.7,1.3), rng.uniform(-.7,.7), (1.4, .9) if splotch else (1.9, .75), not splotch)
                for q in wrapped(pts): d += blob(q) if splotch else path(q)
        body.append(f"<path fill='{tone}' d='{d}'/>")
    d=''
    for _ in range(0 if twig is None else 5):
        for seg in branch(rng, rng.uniform(0,W), rng.uniform(0,W), rng.uniform(-math.pi, math.pi), rng.uniform(60,100), 2):
            for q in wrapped(seg): d += path(q, False)
    if d: body.append(f"<path fill='none' stroke='{twig}' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round' d='{d}'/>")
    d = ''.join((blob(q) if splotch else path(q)) for _ in range(26) for q in wrapped(shape(rng, rng.uniform(0,W), rng.uniform(0,W), rng.uniform(3,7), rng.uniform(0,3))))
    body.append(f"<path fill='{speck}' d='{d}'/>")
    svg = f"<svg xmlns='http://www.w3.org/2000/svg' width='{W}' height='{W}'>{''.join(body)}</svg>"
    return 'url("data:image/svg+xml,' + urllib.parse.quote(svg, safe="/:=' ,.-") + '")'
which = sys.argv[1]
if which == 'nightop':   # multicam black: black base, charcoal/gray brush shapes, gray branches
    print(gen(7, [('#181816', 5, 34), ('#201f1c', 6, 24), ('#292824', 5, 17), ('#33322d', 4, 10)], None, '#060606', splotch=True))
else:                     # field manual: flat dark earth / coyote tones, very low contrast
    print(gen(11, [('#2a2418', 5, 34), ('#332b1d', 6, 24), ('#3d3322', 5, 17), ('#473b27', 4, 10)], '#4a3e2a', '#17130c'))
