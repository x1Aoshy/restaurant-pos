"""
Genera el arte del instalador a partir del icono de la aplicación.

Windows exige BMP y medidas exactas para estas imágenes: NSIS quiere 150x57 en
la cabecera y 164x314 en el panel, y WiX 493x58 y 493x312. Un píxel de más y el
instalador las estira, que es justo el aspecto barato que se quiere evitar.

Se dibuja al cuádruple y se reduce al final: así los bordes y el texto salen
suavizados en vez de dentados. El icono no se dibuja de nuevo, se toma del
propio `icons/icon.png` — si algún día cambia el logo de la aplicación, basta
con volver a ejecutar esto y todo queda igual otra vez.

Las imágenes se guardan en el repositorio: esto solo hay que ejecutarlo cuando
cambie el diseño, no en cada compilación.

    python scripts/installer-art.py
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICON = ROOT / "src-tauri" / "icons" / "icon.png"
CONF = ROOT / "src-tauri" / "tauri.conf.json"
OUT = ROOT / "src-tauri" / "installer"

# Muestreados del icono, no elegidos a ojo: el instalador y la aplicación tienen
# que ser el mismo objeto.
INK = (28, 25, 23)
INK_TOP = (38, 33, 29)
INK_BOTTOM = (20, 17, 15)
PAPER = (250, 247, 242)
GREY = (180, 173, 166)
ORANGE = (217, 119, 6)
WHITE = (255, 255, 255)

FONTS = Path("C:/Windows/Fonts")
CONFIG = json.loads(CONF.read_text(encoding="utf-8"))
# El nombre y la versión salen de la configuración, no copiados aquí: un panel
# que anuncia una versión que no es la que instala se nota, y se nota tarde.
NAME, _, SUFFIX = CONFIG["productName"].rpartition(" ")
VERSION = CONFIG["version"]

S = 4  # supermuestreo


def font(file: str, size: int) -> ImageFont.FreeTypeFont:
    """Segoe UI: la tipografía del propio Windows. En un instalador, lo que no
    se nota es lo que está bien."""
    return ImageFont.truetype(str(FONTS / file), size * S)


def width(draw: ImageDraw.ImageDraw, text: str, f) -> int:
    return draw.textlength(text, font=f)


def vertical_gradient(img: Image.Image, top, bottom) -> None:
    draw = ImageDraw.Draw(img)
    h = img.height
    for y in range(h):
        k = y / max(1, h - 1)
        draw.line(
            [(0, y), (img.width, y)],
            fill=tuple(round(a + (b - a) * k) for a, b in zip(top, bottom)),
        )


def glow(img: Image.Image, center, radius: int, color, strength: float) -> None:
    """Un halo cálido detrás del logotipo. Sin él, el panel oscuro es una mancha
    plana; con él, el logotipo parece estar encima de algo."""
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).ellipse(
        [center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius],
        fill=round(255 * strength),
    )
    mask = mask.filter(ImageFilter.GaussianBlur(radius * 0.55))
    img.paste(Image.new("RGB", img.size, color), (0, 0), mask)


def torn_band(img: Image.Image, top: int, color) -> None:
    """El borde rasgado del icono, repetido abajo del panel.

    Es el detalle que ata las dos cosas: quien vio el icono reconoce el papel
    aunque no sepa decir por qué. Va en un tono casi igual al fondo — decora, no
    compite con el logotipo."""
    draw = ImageDraw.Draw(img)
    tooth = 13 * S
    depth = 7 * S
    draw.rectangle([0, top, img.width, img.height], fill=color)
    x = -tooth // 2
    while x < img.width + tooth:
        draw.polygon(
            [(x, top), (x + tooth // 2, top - depth), (x + tooth, top)], fill=color
        )
        x += tooth


def logo(size: int) -> Image.Image:
    return Image.open(ICON).convert("RGBA").resize((size, size), Image.LANCZOS)


def wordmark(draw: ImageDraw.ImageDraw, x: int, y: int, size: int, tone) -> int:
    """«x1Aoshy» en el color del texto y «POS» en naranja. Devuelve el ancho."""
    bold = font("segoeuib.ttf", size)
    gap = round(size * 0.34) * S
    draw.text((x, y), NAME, font=bold, fill=tone)
    w = width(draw, NAME, bold)
    draw.text((x + w + gap, y), SUFFIX, font=bold, fill=ORANGE)
    return round(w + gap + width(draw, SUFFIX, bold))


def measure(size: int) -> int:
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    bold = font("segoeuib.ttf", size)
    return round(
        width(probe, NAME, bold)
        + round(size * 0.34) * S
        + width(probe, SUFFIX, bold)
    )


def panel(w: int, h: int, icon_px: int) -> Image.Image:
    """Panel oscuro vertical: el lateral de NSIS y la franja de WiX."""
    img = Image.new("RGB", (w * S, h * S), INK)
    vertical_gradient(img, INK_TOP, INK_BOTTOM)

    center_x = w * S // 2
    icon_top = round(h * 0.19) * S
    glow(img, (center_x, icon_top + icon_px * S // 2), round(icon_px * S * 0.8), ORANGE, 0.13)

    torn_band(img, round(h * 0.81) * S, (34, 29, 25))

    draw = ImageDraw.Draw(img)
    mark_size = 17
    text_y = icon_top + icon_px * S + 17 * S
    wordmark(draw, (w * S - measure(mark_size)) // 2, text_y, mark_size, PAPER)

    small = font("segoeui.ttf", 9)
    label = f"v{VERSION}"
    draw.text(
        ((w * S - width(draw, label, small)) // 2, text_y + 26 * S),
        label,
        font=small,
        fill=GREY,
    )

    img = img.resize((w, h), Image.LANCZOS)
    mark = logo(icon_px)
    img.paste(mark, ((w - icon_px) // 2, round(h * 0.19)), mark)
    return img


def strip(w: int, h: int, icon_px: int, pad: int) -> Image.Image:
    """Banda clara con el logotipo a la derecha.

    Va sobre la cabecera blanca del instalador, así que el fondo es blanco puro:
    cualquier otro tono deja una costura visible justo en medio."""
    img = Image.new("RGB", (w * S, h * S), WHITE)
    draw = ImageDraw.Draw(img)

    mark_size = 12
    text_w = measure(mark_size)
    icon_x = (w - pad - icon_px) * S
    text_x = icon_x - 9 * S - text_w
    wordmark(draw, text_x, (h * S - 15 * S) // 2, mark_size, INK)

    img = img.resize((w, h), Image.LANCZOS)
    mark = logo(icon_px)
    img.paste(mark, (w - pad - icon_px, (h - icon_px) // 2), mark)
    return img


def wix_dialog() -> Image.Image:
    """WiX escribe su texto encima de la imagen a partir de x=135, así que el
    arte tiene que caber a la izquierda de ahí o el título saldría ilegible."""
    w, h = 493, 312
    img = Image.new("RGB", (w, h), WHITE)
    img.paste(panel(128, h, 54), (0, 0))
    ImageDraw.Draw(img).rectangle([128, 0, 128, h], fill=ORANGE)
    return img


OUT.mkdir(parents=True, exist_ok=True)
made = [
    ("sidebar.bmp", panel(164, 314, 76)),
    ("header.bmp", strip(150, 57, 38, 10)),
    ("wix-banner.bmp", strip(493, 58, 38, 12)),
    ("wix-dialog.bmp", wix_dialog()),
]
for name, image in made:
    image.save(OUT / name)
    image.save(OUT / name.replace(".bmp", ".png"))  # solo para revisarlo a ojo
    print(f"{name}  {image.width}x{image.height}")
