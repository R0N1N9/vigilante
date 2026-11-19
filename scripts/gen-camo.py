# Seeded generator for a tileable multicam-style pattern: brushy elongated shapes in a few
# close tones, plus thin branch strokes on top. Prints a CSS url("data:...") value.
import math, random, sys, urllib.parse
W = 400
def shape(rng, cx, cy, size, angle, stretch=(1.9, .75), jag=True):
    n = rng.randint(14, 20) if jag else rng.randint(8, 10); pts = []
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
def gen(seed, tones, twig, speck, splotch=False, ground=None):
    rng = random.Random(seed); body=[f"<rect width='{W}' height='{W}' fill='{ground}'/>"] if ground else []
    for tone, grid, size in tones:
        cell = W / grid; d = ''
        for gx in range(grid):
            for gy in range(grid):
                cx = (gx + rng.uniform(0, 1)) * cell; cy = (gy + rng.uniform(0, 1)) * cell
                if splotch:
                    sz = size*rng.uniform(.7,1.3); ang = rng.uniform(-.6,.6)
                    for k in range(rng.randint(2, 4)):
                        ox, oy = (rng.uniform(-.9,.9)*sz*1.3, rng.uniform(-.6,.6)*sz) if k else (0, 0)
                        for q in wrapped(shape(rng, cx+ox, cy+oy, sz*rng.uniform(.55,.9), ang+rng.uniform(-.4,.4), (1.35, .95), False)): d += blob(q)
                else:
                    for q in wrapped(shape(rng, cx, cy, size*rng.uniform(.7,1.3), rng.uniform(-.7,.7))): d += path(q)
        body.append(f"<path fill='{tone}' d='{d}'/>")
    d=''
    for _ in range(0 if twig is None else 6):
        for seg in branch(rng, rng.uniform(0,W), rng.uniform(0,W), rng.uniform(-math.pi, math.pi), rng.uniform(60,100), 2):
            for q in wrapped(seg): d += path(q, False)
    if d: body.append(f"<path fill='none' stroke='{twig}' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round' d='{d}'/>")
    d = ''.join((blob(q) if splotch else path(q)) for _ in range(26) for q in wrapped(shape(rng, rng.uniform(0,W), rng.uniform(0,W), rng.uniform(3,7), rng.uniform(0,3))))
    body.append(f"<path fill='{speck}' d='{d}'/>")
    svg = f"<svg xmlns='http://www.w3.org/2000/svg' width='{W}' height='{W}'>{''.join(body)}</svg>"
    return 'url("data:image/svg+xml,' + urllib.parse.quote(svg, safe="/:=' ,.-") + '")'
def digital(seed, tones, cell=5, n=48, L=8, breakup=0.0):
    # Pixel camo: smooth periodic value noise, quantized into tones, drawn as merged square runs.
    rng = random.Random(seed); lat = [[rng.random() for _ in range(L)] for _ in range(L)]
    lat2 = [[rng.random() for _ in range(L*2)] for _ in range(L*2)]
    def noise(g, size, x, y):
        fx, fy = x/n*size, y/n*size; x0, y0 = int(fx) % size, int(fy) % size; x1, y1 = (x0+1) % size, (y0+1) % size
        tx, ty = fx-int(fx), fy-int(fy); sx, sy = tx*tx*(3-2*tx), ty*ty*(3-2*ty)
        a = g[y0][x0]*(1-sx)+g[y0][x1]*sx; b = g[y1][x0]*(1-sx)+g[y1][x1]*sx
        return a*(1-sy)+b*sy
    v = [[.65*noise(lat, L, x, y)+.35*noise(lat2, L*2, x, y)+rng.uniform(-.025, .025) for x in range(n)] for y in range(n)]
    flat = sorted(c for row in v for c in row); cuts = [flat[int(len(flat)*q)] for q in (.3, .58, .82)]
    level = lambda c: sum(c > k for k in cuts)
    lv = [[level(v[y][x]) for x in range(n)] for y in range(n)]
    if breakup:  # stepped, pixel-broken edges: some edge cells take a neighbour's tone
        src = [row[:] for row in lv]
        for y in range(n):
            for x in range(n):
                nb = [src[(y+dy) % n][(x+dx) % n] for dx, dy in ((1,0),(-1,0),(0,1),(0,-1))]
                if any(b != src[y][x] for b in nb) and rng.random() < breakup: lv[y][x] = rng.choice(nb)
    W2 = n*cell; paths = ['']*len(tones)
    for y in range(n):
        x = 0
        while x < n:
            l = lv[y][x]; x2 = x
            while x2 + 1 < n and lv[y][x2+1] == l: x2 += 1
            if l: paths[l] += f'M{x*cell} {y*cell}h{(x2-x+1)*cell}v{cell}h-{(x2-x+1)*cell}z'
            x = x2 + 1
    body = f"<rect width='{W2}' height='{W2}' fill='{tones[0]}'/>" + ''.join(f"<path fill='{tones[i]}' d='{paths[i]}'/>" for i in range(1, len(tones)) if paths[i])
    svg = f"<svg xmlns='http://www.w3.org/2000/svg' width='{W2}' height='{W2}' shape-rendering='crispEdges'>{body}</svg>"
    return 'url("data:image/svg+xml,' + urllib.parse.quote(svg, safe="/:=' ,.-") + '")'
which = sys.argv[1]
if which == 'urban':     # urban digital: cool grays
    print(digital(31, ['#15181b', '#1f2327', '#2a2f35', '#383e45'], cell=12, n=30, L=5, breakup=.3))
elif which == 'nightop':   # multicam black: black base, charcoal/gray brush shapes, gray branches
    print(gen(7, [('#161614', 4, 38), ('#1d1c1a', 5, 27), ('#252420', 5, 18), ('#2e2d29', 6, 11), ('#38372f', 4, 6)], None, '#060606', splotch=True))
else:                     # field op: OCP-style tones (tan, khaki, olive, brown) darkened for a background, with branches
    # OCP-style, toned down for a background: khaki ground, large tan and pale-green shapes, olive and
    # dark green, a neutral (not orange) brown, cream flecks; thin dark branches
    print(gen(23, [('#575039', 5, 40), ('#4a4f37', 4, 28), ('#3c432e', 5, 19), ('#3b3528', 5, 12), ('#2f3526', 4, 8)], None, '#6b6449', splotch=True, ground='#4a4431'))
