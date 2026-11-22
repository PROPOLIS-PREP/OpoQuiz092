"""Prepara las imágenes del avatar para el juego.

    py tools/avatar.py              optimiza assets/avatar/<hueco>/*.png -> assets/avatar/web/<id>.webp
    py tools/avatar.py --muestra F  además dibuja una hoja de prueba con todas las combinaciones en F

Requiere Pillow. Solo hace falta ejecutarlo al añadir o cambiar una imagen; build.mjs usa los .webp ya hechos.
- Fondos: se recorta la escena del círculo (sin su aro azul) y se deja redonda.
- Resto: se recorta al contenido (sin márgenes transparentes) y se limita a 320 px de lado.
"""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
ORIG = RAIZ / "assets" / "avatar"
WEB = ORIG / "web"
LADO_MAX = 320
CALIDAD = 84


def recortar_fondo(im):
    c, r = 192, 156                       # escena interior, dentro del aro azul del original
    im = im.crop((c - r, c - r, c + r, c + r))
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, im.size[0] - 1, im.size[1] - 1), fill=255)
    im.putalpha(Image.composite(im.split()[3], mask, mask))
    return im.resize((240, 240), Image.LANCZOS)


def optimizar():
    WEB.mkdir(exist_ok=True)
    cajas = {}
    for png in sorted(ORIG.glob("*/*.png")):
        hueco, ident = png.parent.name, png.stem
        im = Image.open(png).convert("RGBA")
        if hueco == "retratos":
            im.thumbnail((384, 384), Image.LANCZOS)
            original = Image.new("RGBA", (384, 384))
            original.alpha_composite(im, ((384 - im.width) // 2, (384 - im.height) // 2))
            im = original
        if hueco == "fondos":
            out = recortar_fondo(im)
            cajas[ident] = [0, 0, 384, 384]
        else:
            caja = im.split()[3].point(lambda a: 255 if a > 8 else 0).getbbox()
            cajas[ident] = list(caja)
            out = im.crop(caja)
            k = min(1.0, LADO_MAX / max(out.size))
            if k < 1:
                out = out.resize((round(out.size[0] * k), round(out.size[1] * k)), Image.LANCZOS)
        out.save(WEB / f"{ident}.webp", "WEBP", quality=CALIDAD, method=6)
    (WEB / "cajas.json").write_text(json.dumps(cajas, indent=1), encoding="utf-8")
    total = sum(f.stat().st_size for f in WEB.glob("*.webp"))
    print(f"{len(cajas)} imágenes optimizadas en {WEB.relative_to(RAIZ)} ({total // 1024} KB)")


# ---------- hoja de prueba: misma lógica de composición que el juego ----------
def cargar(ident):
    return Image.open(WEB / f"{ident}.webp").convert("RGBA")


def componer(av, L):
    S = L["lienzo"]
    lienzo = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    h = L["hueco"]
    circ = Image.new("L", (S, S), 0)
    ImageDraw.Draw(circ).ellipse((h["x"] - h["r"], h["y"] - h["r"], h["x"] + h["r"], h["y"] + h["r"]), fill=255)
    # fondo
    f = cargar(av["fondo"]).resize((2 * h["r"] + 4, 2 * h["r"] + 4), Image.LANCZOS)
    capa = Image.new("RGBA", (S, S), (0, 0, 0, 0)); capa.paste(f, (h["x"] - h["r"] - 2, h["y"] - h["r"] - 2), f)
    lienzo.alpha_composite(Image.composite(capa, Image.new("RGBA", (S, S)), circ))
    # Retrato preparado con la gorra y accesorio independiente.
    ag = L["agente"]
    dib = Image.new("RGBA", (384, 384), (0, 0, 0, 0))
    agente = av["agente"]
    ident = L["agentes"][agente]["retratos"].get(av.get("gorra"), agente)
    base = cargar(ident)
    caja = L["cajas"][ident]
    dib.alpha_composite(base.resize((caja[2] - caja[0], caja[3] - caja[1]), Image.LANCZOS), (caja[0], caja[1]))
    extra = av.get("extra")
    pos = L["piezas"].get(extra, {}).get(agente)
    if pos:
        im = cargar(extra)
        w = pos[2]
        hgt = round(im.height * w / im.width)
        dib.alpha_composite(im.resize((w, hgt), Image.LANCZOS), (pos[0], pos[1]))
    k = ag["escala"]; dib = dib.resize((round(384 * k), round(384 * k)), Image.LANCZOS)
    capa = Image.new("RGBA", (S, S), (0, 0, 0, 0)); capa.paste(dib, (ag["x"], ag["y"]), dib)
    # recorte: círculo en la mitad de abajo, libre por arriba (la cabeza asoma sobre el marco)
    m = circ.copy(); ImageDraw.Draw(m).rectangle((0, 0, S, h["y"]), fill=255)
    # marco
    marco = cargar(av["marco"]); cm = json.loads((WEB / "cajas.json").read_text())[av["marco"]]
    marco = marco.resize((cm[2] - cm[0], cm[3] - cm[1]), Image.LANCZOS)
    lienzo.paste(marco, (cm[0], cm[1]), marco)
    lienzo.alpha_composite(Image.composite(capa, Image.new("RGBA", (S, S)), m))
    return lienzo


def muestra(destino):
    L = json.loads((RAIZ / "data" / "avatar.json").read_text(encoding="utf-8"))
    L["cajas"] = json.loads((WEB / "cajas.json").read_text(encoding="utf-8"))
    gorras = list(L["agentes"]["agente_m"]["retratos"])
    extras = ["nada", "gafas", "bigote", "pinganillo", "bufanda", "silbato", "radio"]
    filas = []
    for ag in ("agente_f", "agente_m"):
        filas.append([dict(agente=ag, gorra=g, extra="nada", fondo="retiro", marco="basico") for g in gorras])
        filas.append([dict(agente=ag, gorra=L["agentes"][ag]["gorraPropia"], extra=e, fondo="granvia", marco="plata") for e in extras[1:]])
    T = 200
    hoja = Image.new("RGBA", (T * 6, T * len(filas)), (40, 44, 60, 255))
    for j, fila in enumerate(filas):
        for i, av in enumerate(fila):
            hoja.alpha_composite(componer(av, L).resize((T, T), Image.LANCZOS), (i * T, j * T))
    hoja.save(destino)
    print("hoja de prueba:", destino)


if __name__ == "__main__":
    optimizar()
    if "--muestra" in sys.argv:
        muestra(sys.argv[sys.argv.index("--muestra") + 1])
