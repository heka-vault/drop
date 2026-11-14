"""Build self-contained SVG illustrations. Run with Python 3; no packages needed."""
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DURATION = 24
BEATS = [
    ("Seal it before it leaves.", "drop send encrypts on the sender's machine."),
    ("Only scrambled bytes go up.", "The server stores ciphertext it cannot read."),
    ("The key takes a different route.", "Browsers never send the #fragment to a server."),
    ("A preview can't spend it.", "The page waits for a person to click Reveal."),
    ("Open here. Gone there.", "Your browser decrypts. The last open deletes the server copy."),
    ("One open. Then it's gone.", "Default: 1 open, 24 hours. Expiry also deletes the ciphertext."),
]
PALETTES = {
    "light": dict(bg="#edebe4", paper="#f6f5f0", ink="#101a33", muted="#424b63",
                  line="#a5aabc", lapis="#13286e", ochre="#6a4300", gold="#a66a00",
                  teal="#075b52", top="#e0e2e7", left="#c8cdd8", right="#b4bdcd"),
    "dark": dict(bg="#08111f", paper="#0e1a30", ink="#ecebe4", muted="#a8b0c3",
                 line="#53627d", lapis="#9fb7ff", ochre="#f0b955", gold="#e8a83a",
                 teal="#5fd3c2", top="#243858", left="#182b48", right="#12213a"),
}


def text(x, y, words, cls="", anchor="start"):
    return f'<text x="{x}" y="{y}" class="{cls}" text-anchor="{anchor}">{escape(words)}</text>'


def group(cls, body):
    return f'<g class="{cls}">{body}</g>'


def timeline(name, frames, easing="linear"):
    rules = " ".join(f'{t / DURATION * 100:.5f}% {{{style}}}' for t, style in frames)
    return f'.{name} {{animation:{name} 24s {easing} infinite;}}\n@keyframes {name} {{{rules}}}\n'


def visible(name, start, end=23.6):
    frames = [(0, "opacity:0"), (start, "opacity:0"), (start + .24, "opacity:1"),
              (end - .24, "opacity:1"), (end, "opacity:0"), (24, "opacity:0")]
    # Initial frame is already legible and matches the end of the loop.
    if start == 0:
        frames = [(0, "opacity:1"), (end - .24, "opacity:1"), (end, "opacity:0"),
                  (23.76, "opacity:0"), (24, "opacity:1")]
    return timeline(name, frames)


def plinth(x):
    return f'''<g transform="translate({x} 505)">
    <path d="M-144 0 0-55 144 0 0 55Z" fill="var(--top)"/>
    <path d="M-144 0 0 55V69L-144 14Z" fill="var(--left)"/>
    <path d="M0 55 144 0V14L0 69Z" fill="var(--right)"/>
    <path d="M-144 0 0-55 144 0 0 55Z" class="fine"/>
    </g>'''


def envelope(x, y):
    return f'''<g transform="translate({x} {y})">
    <rect x="-59" y="-36" width="118" height="76" rx="4" fill="#13286e" stroke="#9fb7ff" stroke-width="2"/>
    <path d="m-57-32 57 38 57-38M-57 36l37-27m77 27L20 9" fill="none" stroke="#9fb7ff" stroke-width="2"/>
    <rect x="-17" y="-9" width="34" height="24" rx="2" fill="#edebe4"/>
    <path d="M-10-2h7m5 0h8M-10 4h4m4 0h12M-10 10h9m4 0h7" stroke="#13286e" stroke-width="3"/>
    </g>'''


def build(theme, still=False):
    palette = PALETTES[theme]
    css = ':root{' + ''.join(f'--{k}:{v};' for k, v in palette.items()) + '}\n'
    css += '''text{font-family:Arial,Helvetica,sans-serif;fill:var(--ink);font-size:22px}
    .heading{font-size:44px;font-weight:700;letter-spacing:-1.2px}
    .sub{font-size:23px;fill:var(--muted)} .small{font-size:18px;fill:var(--muted)}
    .label{font-size:24px;font-weight:600} .mono{font-family:ui-monospace,Consolas,monospace}
    .gold{fill:var(--ochre)} .success{fill:var(--teal)} .on-water{fill:#ecebe4}
    .fine{fill:none;stroke:var(--line);stroke-width:1.5;stroke-linejoin:round}
    .route{fill:none;stroke:var(--lapis);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
    .key-route{fill:none;stroke:var(--gold);stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}
    .stage,.link,.routes,.key-tag,.plain,.sealed,.delivered,.burn,.revealed,.deleted-status,.await-status,.static-title{opacity:0}
    .stage,.key-tag,.sealed,.delivered,.burn,.cursor,.reveal-button{transform-box:view-box}
    '''
    for i in range(6):
        css += visible(f"beat-{i}", i * 4, (i + 1) * 4 if i < 5 else 23.6)
    css += visible("link", 5.6)
    css += visible("routes", 8.1)
    css += visible("plain", 0, 2.3)
    css += visible("await-status", 5.5, 16.4)
    css += visible("deleted-status", 17.5)
    css += visible("revealed", 17.7)
    css += visible("reveal-button", 9.8, 16.2)
    css += visible("cursor", 14.9, 16.25)
    css += timeline("sealed", [
        (0,"opacity:0;transform:translate(0,0)"), (2,"opacity:0;transform:translate(0,0)"),
        (2.35,"opacity:1;transform:translate(0,0)"), (4.2,"opacity:1;transform:translate(0,0)"),
        (5.4,"opacity:1;transform:translate(410px,-18px)"), (16.55,"opacity:1;transform:translate(410px,-18px)"),
        (17.3,"opacity:0;transform:translate(410px,-24px)"), (24,"opacity:0;transform:translate(410px,-24px)")],
        "cubic-bezier(0.77,0,0.175,1)")
    css += timeline("key-tag", [
        (0,"opacity:0;transform:translate(0,0)"), (5.6,"opacity:0;transform:translate(0,0)"),
        (5.84,"opacity:1;transform:translate(0,0)"), (8.5,"opacity:1;transform:translate(0,0)"),
        (9.6,"opacity:1;transform:translate(170px,72px)"), (23.36,"opacity:1;transform:translate(170px,72px)"),
        (23.6,"opacity:0;transform:translate(170px,72px)"), (24,"opacity:0;transform:translate(170px,72px)")],
        "cubic-bezier(0.77,0,0.175,1)")
    css += timeline("request", [
        (0,"opacity:0;transform:translateY(0)"), (8.4,"opacity:0;transform:translateY(0)"),
        (8.6,"opacity:1;transform:translateY(0)"), (9.6,"opacity:1;transform:translateY(66px)"),
        (9.9,"opacity:0;transform:translateY(66px)"), (24,"opacity:0;transform:translateY(66px)")],
        "cubic-bezier(0.77,0,0.175,1)")
    css += timeline("delivered", [
        (0,"opacity:0;transform:translate(0,0)"), (16.1,"opacity:0;transform:translate(0,0)"),
        (16.3,"opacity:1;transform:translate(0,0)"), (17.35,"opacity:1;transform:translate(410px,15px)"),
        (17.8,"opacity:0;transform:translate(410px,15px)"), (24,"opacity:0;transform:translate(410px,15px)")],
        "cubic-bezier(0.77,0,0.175,1)")
    css += timeline("burn", [
        (0,"opacity:0;transform:translateY(0)"), (16.7,"opacity:0;transform:translateY(0)"),
        (17,"opacity:1;transform:translateY(-6px)"), (17.8,"opacity:0;transform:translateY(-35px)"),
        (24,"opacity:0;transform:translateY(-35px)")], "cubic-bezier(0.23,1,0.32,1)")
    css += timeline("press", [
        (0,"transform:translate(0,0)"), (15.84,"transform:translate(0,0)"),
        (15.92,"transform:translate(0,3px)"), (16,"transform:translate(0,0)"),
        (24,"transform:translate(0,0)")], "cubic-bezier(0.23,1,0.32,1)")
    static = '''*{animation:none!important} .stage,.plain,.sealed,.delivered,.burn,.reveal-button,.cursor,.request,.await-status{opacity:0}
    .static-title,.link,.routes,.key-tag,.revealed,.deleted-status{opacity:1}
    .key-tag{transform:translate(170px,72px)}'''
    css += '@media (prefers-reduced-motion: reduce){' + static + '}\n'
    if still:
        css += static
    parts = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-labelledby="title description">
    <title>Heka Drop: a secret, one link, one open</title>
    <desc id="description">The CLI encrypts locally and uploads only ciphertext. A link carries its key in the #fragment, which browsers never send to a server. The recipient clicks Reveal and decrypts in their browser. The server deletes its ciphertext after the last allowed open or expiry. Defaults: 1 open and 24 hours. The server supplies the browser's JavaScript.</desc>
    <style>{css}</style>
    <rect width="1280" height="720" fill="var(--bg)"/>
    ''']
    # Use a product label, not a substitute for Heka's custom wordmark.
    parts += [text(64, 59, "Heka Drop", "label"), text(1216, 59, "How a plain drop works", "small", "end"),
              '<path d="M64 82H1216" class="fine"/>']
    for i, (title, sub) in enumerate(BEATS):
        parts.append(group(f"stage beat-{i}", text(64, 145, title, "heading") + text(64, 188, sub, "sub")))
    parts.append(group("static-title", text(64,145,"A secret. One link. One open.","heading") +
                       text(64,188,"Ciphertext is deleted on the last open or at expiry.","sub")))
    parts.append(group("link", '''<rect x="255" y="248" width="770" height="66" rx="4" fill="var(--paper)" stroke="var(--line)"/>
        <path d="M850 258V304" class="fine"/>''' +
        text(280,290,"https://drop.example.com/d/id","mono") + text(871,290,"#fragment","mono gold")))
    parts.append(group("routes", '''<path d="M640 316V368m-6-7 6 7 6-7" class="route"/>
        <path d="M1008 316H1105V373m-6-7 6 7 6-7" class="key-route"/>''' +
        text(623,346,"Request", "small", "end")))
    parts.append(group("request", '''<rect x="616" y="314" width="48" height="23" rx="3" fill="var(--paper)" stroke="var(--lapis)"/>''' + text(640,331,"/d/id","small mono","middle")))
    parts += [plinth(230), plinth(640), plinth(1050)]
    # Routes are under the objects; there is never a key route into the server.
    parts.append('<path d="M369 475H489m-7-6 7 6-7 6M779 475H899m-7-6 7 6-7 6" class="route"/>')
    parts += [text(428,510,"Ciphertext","small","middle"), text(838,510,"On Reveal","small","middle")]
    parts.append('''<rect x="110" y="360" width="240" height="148" rx="4" fill="#0b1a38" stroke="var(--line)" stroke-width="2"/>
        <path d="M110 397H350" stroke="#53627d"/>
        <circle cx="128" cy="378" r="3" fill="#a8b0c3"/><circle cx="140" cy="378" r="3" fill="#a8b0c3"/>
        ''' + text(157,385,"$ drop send","mono on-water"))
    parts.append('''<path d="M550 409 640 365 730 409V483L640 527 550 483Z" fill="var(--left)" stroke="var(--line)" stroke-width="1.5"/>
        <path d="M550 409 640 453 730 409 640 365Z" fill="var(--top)"/>
        <path d="M640 453 730 409V483L640 527Z" fill="var(--right)"/>
        <path d="M570 410 640 444 710 410" class="fine"/>
        <path d="m660 477 45-22m-45 34 45-22" class="fine"/>''')
    parts.append('''<rect x="932" y="373" width="236" height="160" rx="4" fill="var(--paper)" stroke="var(--lapis)" stroke-width="2"/>
        <path d="M932 402H1168" class="fine"/><circle cx="948" cy="388" r="3" fill="var(--line)"/>
        ''' + text(961,394,"drop.example.com","small mono"))
    parts.append(group("plain", '''<rect x="182" y="414" width="96" height="70" rx="3" fill="#edebe4"/>
        <path d="M198 433h64M198 446h44M198 459h54" stroke="#424b63" stroke-width="3"/>'''))
    parts.append(group("sealed", envelope(230,450)))
    parts.append(group("delivered", envelope(640,432)))
    parts.append(group("reveal-button", group("press", '''<rect x="980" y="441" width="140" height="48" rx="6" fill="var(--lapis)"/>''' +
        f'<text x="1050" y="472" text-anchor="middle" style="fill:{"#f6f5f0" if theme == "light" else "#08111f"};font-weight:600">Reveal</text>')))
    parts.append(group("cursor", '<path d="m1093 474 0 28 8-8 7 13 7-4-8-13 12-1Z" fill="var(--ink)" stroke="var(--paper)" stroke-width="2"/>'))
    parts.append(group("burn", '''<path d="M603 451c-20-20 14-30 5-54 18 9 16 25 17 30 9-16 7-28 7-38 27 24 21 38 28 45 7-7 12-14 11-23 24 24 14 45-9 48Z" fill="var(--ink)"/>
        <path d="m589 415-7-12 10 3Zm92-16 4-12 7 9Zm-49-20-5-9 11 1Z" fill="var(--muted)"/>'''))
    parts.append(group("revealed", '''<path d="M991 424h101l18 18v70H991Z" fill="var(--bg)" stroke="var(--line)"/>
        <path d="M1092 424v18h18" class="fine"/>
        <path d="M1008 449h60M1008 460h75M1008 471h42" stroke="var(--muted)" stroke-width="3"/>
        <path d="m1071 487 9 9 18-20" fill="none" stroke="var(--teal)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'''))
    parts.append(group("key-tag", '''<g transform="translate(935 283)">
        <path d="M-68-23H50L68 0 50 23H-68Z" fill="var(--paper)" stroke="var(--gold)" stroke-width="2.5"/>
        <circle cx="52" cy="0" r="4" fill="none" stroke="var(--gold)" stroke-width="2"/>
        ''' + text(-49,8,"#key","mono gold") + '</g>'))
    parts += [text(230,606,"Sender's CLI","label","middle"), text(640,606,"Drop server","label","middle"), text(1050,606,"Recipient's browser","label","middle"),
              text(230,636,"Encrypts locally","small","middle"), text(1050,636,"Decrypts locally","small","middle")]
    parts.append(group("await-status",text(640,636,"Ciphertext only","small","middle")))
    parts.append(group("deleted-status",text(640,636,"Ciphertext deleted","small","middle")))
    parts += ['<path d="M64 662H1216" class="fine"/>',text(64,696,"The server never sees the key.","small gold"),text(1216,696,"Default: 1 open / 24 hours","small","end"),'</svg>']
    return '\n'.join(parts).replace('<title>', '<title id="title">')


for scheme in PALETTES:
    (ROOT / f"explainer-{scheme}.svg").write_text(build(scheme))
(ROOT / "explainer-still.svg").write_text(build("light", still=True))

(ROOT / "explainer-still-dark.svg").write_text(build("dark", still=True))
