"""
Generates the demo bills shown on the BillSahi home page.

One source of truth: each sample is defined once here, and the script writes
  public/samples/<slug>.json  -> exactly what is printed (the "ground truth" reading)
  public/samples/<slug>.jpg   -> a phone-photo-style image of the thermal receipt

The JSON doubles as (a) test fixtures for the verdict engine and
(b) a fallback if the AI is unavailable during a demo.

Run: python3 scripts/make_samples.py
"""

import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / "public" / "samples"
OUT.mkdir(parents=True, exist_ok=True)

MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
MONO_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
COLS = 42
CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
UNAMBIGUOUS = set("ACDEFGHJKLMNPQRTUVWXY")


def check_char(first14: str) -> str:
    factor, total = 1, 0
    for ch in first14:
        d = factor * CHARS.index(ch)
        total += d // 36 + d % 36
        factor = 2 if factor == 1 else 1
    return CHARS[(36 - total % 36) % 36]


def demo_gstin(start_entity: int) -> str:
    """A checksum-valid GSTIN built on the sample PAN, with an easy-to-read check char."""
    for entity in "123456789":
        if int(entity) < start_entity:
            continue
        first14 = f"27ABCDE1234F{entity}Z"
        c = check_char(first14)
        if c in UNAMBIGUOUS:
            return first14 + c
    raise RuntimeError("no unambiguous gstin")


def money(n: float) -> str:
    return f"{n:,.2f}".replace(",", "")


def lr(left: str, right: str) -> str:
    gap = COLS - len(left) - len(right)
    return left + " " * max(1, gap) + right


def center(s: str) -> str:
    return s.center(COLS)


# ───────────────────────── samples ─────────────────────────

restaurant_gstin = demo_gstin(1)
kirana_gstin = demo_gstin(int(restaurant_gstin[12]) + 1)
pharma_valid = demo_gstin(int(kirana_gstin[12]) + 1)
# Planted: one wrong check character, so the GSTIN fails the official check.
pharma_gstin = pharma_valid[:14] + next(c for c in "KMNPQRTUVW" if c != pharma_valid[14])

SAMPLES = []

# 1) Restaurant: a line-total error and a 10% service charge.
SAMPLES.append(
    {
        "slug": "restaurant",
        "label": "Restaurant",
        "bill": {
            "isBill": True,
            "notBillReason": None,
            "billType": "restaurant",
            "merchantName": "Tapri Junction Cafe",
            "merchantAddress": "Shop 4, Marol Naka, Andheri East, Mumbai 400059",
            "gstin": restaurant_gstin,
            "billNumber": "TJ/2611/0457",
            "billDate": "2026-11-21",
            "items": [
                {"name": "Masala Dosa", "quantity": 2, "unitPrice": 120, "mrp": None, "amount": 240, "confidence": "high"},
                {"name": "Pav Bhaji", "quantity": 1, "unitPrice": 160, "mrp": None, "amount": 160, "confidence": "high"},
                # planted: 3 x 40 = 120, printed 140
                {"name": "Filter Coffee", "quantity": 3, "unitPrice": 40, "mrp": None, "amount": 140, "confidence": "high"},
                {"name": "Fresh Lime Soda", "quantity": 2, "unitPrice": 70, "mrp": None, "amount": 140, "confidence": "high"},
            ],
            "charges": [{"label": "Service Charge @10%", "kind": "service_charge", "rate": 10, "amount": 68}],
            "discounts": [],
            "taxes": [
                {"label": "CGST @2.5%", "kind": "CGST", "rate": 2.5, "taxableAmount": None, "amount": 18.7},
                {"label": "SGST @2.5%", "kind": "SGST", "rate": 2.5, "taxableAmount": None, "amount": 18.7},
            ],
            "taxesIncludedInPrices": False,
            "subtotal": 680,
            "roundOff": -0.4,
            "grandTotal": 785,
            "dueDate": None,
            "lateFee": None,
            "readingNotes": [],
        },
        "lines": [
            ("big", "TAPRI JUNCTION CAFE"),
            ("c", "Shop 4, Marol Naka, Andheri East"),
            ("c", "Mumbai 400059"),
            ("c", f"GSTIN: {restaurant_gstin}"),
            ("-",),
            ("t", lr("Bill No: TJ/2611/0457", "Date: 21/11/2026")),
            ("t", lr("Table: 7   Covers: 3", "Time: 20:41")),
            ("t", "Steward: Ramesh"),
            ("-",),
            ("b", f"{'Item':<18}{'Qty':>4}{'Rate':>9}{'Amount':>11}"),
            ("-",),
            ("t", f"{'Masala Dosa':<18}{2:>4}{money(120):>9}{money(240):>11}"),
            ("t", f"{'Pav Bhaji':<18}{1:>4}{money(160):>9}{money(160):>11}"),
            ("t", f"{'Filter Coffee':<18}{3:>4}{money(40):>9}{money(140):>11}"),
            ("t", f"{'Fresh Lime Soda':<18}{2:>4}{money(70):>9}{money(140):>11}"),
            ("-",),
            ("t", lr("Sub Total", money(680))),
            ("t", lr("Service Charge @10%", money(68))),
            ("t", lr("CGST @2.5%", money(18.7))),
            ("t", lr("SGST @2.5%", money(18.7))),
            ("t", lr("Round Off", "-0.40")),
            ("=",),
            ("b", lr("GRAND TOTAL", "Rs. " + money(785))),
            ("=",),
            ("c", "Thank you! Visit again :)"),
            ("small", "Demo bill made for BillSahi"),
        ],
    }
)

# 2) Medical store: one item above MRP, GSTIN with a wrong check character.
SAMPLES.append(
    {
        "slug": "medical",
        "label": "Medical store",
        "bill": {
            "isBill": True,
            "notBillReason": None,
            "billType": "pharmacy",
            "merchantName": "Shubh Laabh Medicals",
            "merchantAddress": "Gala 2, Station Road, Thane West 400601",
            "gstin": pharma_gstin,
            "billNumber": "SLM-8821",
            "billDate": "2026-11-18",
            "items": [
                {"name": "PCM 650 Tab 15s", "quantity": 2, "unitPrice": 33.5, "mrp": 33.5, "amount": 67, "confidence": "high"},
                # planted: rate 125 above MRP 118
                {"name": "Cough Syrup 100ml", "quantity": 1, "unitPrice": 125, "mrp": 118, "amount": 125, "confidence": "high"},
                {"name": "Vit C Chew 15s", "quantity": 1, "unitPrice": 26, "mrp": 26, "amount": 26, "confidence": "high"},
                {"name": "ORS Sachet 21g", "quantity": 4, "unitPrice": 21, "mrp": 21, "amount": 84, "confidence": "high"},
            ],
            "charges": [],
            "discounts": [{"label": "Less: Discount 5%", "amount": 15.1}],
            "taxes": [
                {"label": "CGST 2.5%", "kind": "CGST", "rate": 2.5, "taxableAmount": 273.24, "amount": 6.83},
                {"label": "SGST 2.5%", "kind": "SGST", "rate": 2.5, "taxableAmount": 273.24, "amount": 6.83},
            ],
            "taxesIncludedInPrices": True,
            "subtotal": 302,
            "roundOff": 0.1,
            "grandTotal": 287,
            "dueDate": None,
            "lateFee": None,
            "readingNotes": [],
        },
        "lines": [
            ("big", "SHUBH LAABH MEDICALS"),
            ("c", "Gala 2, Station Road, Thane West"),
            ("c", "Thane 400601"),
            ("c", f"GSTIN: {pharma_gstin}"),
            ("-",),
            ("t", lr("Inv No: SLM-8821", "Date: 18/11/2026")),
            ("t", lr("Patient: Walk-in", "Dr: Self")),
            ("-",),
            ("b", f"{'Item':<17}{'Qty':>3}{'MRP':>7}{'Rate':>8}{'Amt':>7}"),
            ("-",),
            ("t", f"{'PCM 650 Tab 15s':<17}{2:>3}{money(33.5):>7}{money(33.5):>8}{money(67):>7}"),
            ("t", f"{'Cough Syrup 100ml':<17}{1:>3}{money(118):>7}{money(125):>8}{money(125):>7}"),
            ("t", f"{'Vit C Chew 15s':<17}{1:>3}{money(26):>7}{money(26):>8}{money(26):>7}"),
            ("t", f"{'ORS Sachet 21g':<17}{4:>3}{money(21):>7}{money(21):>8}{money(84):>7}"),
            ("-",),
            ("t", lr("Gross Amount", money(302))),
            ("t", lr("Less: Discount 5%", "-" + money(15.1))),
            ("t", lr("Round Off", "+0.10")),
            ("=",),
            ("b", lr("NET PAYABLE", "Rs. " + money(287))),
            ("=",),
            ("t", "GST summary (included in prices)"),
            ("t", f"{'Taxable':>10}{'CGST 2.5%':>14}{'SGST 2.5%':>14}"),
            ("t", f"{money(273.24):>10}{money(6.83):>14}{money(6.83):>14}"),
            ("-",),
            ("c", "Get well soon!"),
            ("small", "Demo bill made for BillSahi"),
        ],
    }
)

# 3) Kirana: everything correct (composition dealer, no GST charged).
SAMPLES.append(
    {
        "slug": "kirana",
        "label": "Kirana store",
        "bill": {
            "isBill": True,
            "notBillReason": None,
            "billType": "grocery_retail",
            "merchantName": "Navratna Provision Stores",
            "merchantAddress": "Shop 11, Pant Nagar, Ghatkopar East, Mumbai 400075",
            "gstin": kirana_gstin,
            "billNumber": "3318",
            "billDate": "2026-11-22",
            "items": [
                {"name": "Toor Dal 1kg", "quantity": 1, "unitPrice": 165, "mrp": None, "amount": 165, "confidence": "high"},
                {"name": "Basmati Rice 5kg", "quantity": 1, "unitPrice": 540, "mrp": 599, "amount": 540, "confidence": "high"},
                {"name": "Butter 500g", "quantity": 1, "unitPrice": 285, "mrp": 290, "amount": 285, "confidence": "high"},
                {"name": "Sugar 1kg", "quantity": 2, "unitPrice": 48, "mrp": None, "amount": 96, "confidence": "high"},
                {"name": "Tea 250g", "quantity": 1, "unitPrice": 145, "mrp": 150, "amount": 145, "confidence": "high"},
            ],
            "charges": [],
            "discounts": [],
            "taxes": [],
            "taxesIncludedInPrices": None,
            "subtotal": None,
            "roundOff": None,
            "grandTotal": 1231,
            "dueDate": None,
            "lateFee": None,
            "readingNotes": [],
        },
        "lines": [
            ("big", "NAVRATNA PROVISION STORES"),
            ("c", "Shop 11, Pant Nagar, Ghatkopar East"),
            ("c", "Mumbai 400075"),
            ("c", f"GSTIN: {kirana_gstin}"),
            ("c", "Composition taxable person, not"),
            ("c", "eligible to collect tax on supplies"),
            ("-",),
            ("t", lr("Bill No: 3318", "Date: 22/11/2026")),
            ("-",),
            ("b", f"{'Item':<17}{'Qty':>4}{'MRP':>7}{'Rate':>7}{'Amt':>7}"),
            ("-",),
            ("t", f"{'Toor Dal 1kg':<17}{1:>4}{'-':>7}{money(165):>7}{money(165):>7}"),
            ("t", f"{'Basmati Rice 5kg':<17}{1:>4}{money(599):>7}{money(540):>7}{money(540):>7}"),
            ("t", f"{'Butter 500g':<17}{1:>4}{money(290):>7}{money(285):>7}{money(285):>7}"),
            ("t", f"{'Sugar 1kg':<17}{2:>4}{'-':>7}{money(48):>7}{money(96):>7}"),
            ("t", f"{'Tea 250g':<17}{1:>4}{money(150):>7}{money(145):>7}{money(145):>7}"),
            ("-",),
            ("t", lr("Total Items: 5", "Total Qty: 6")),
            ("=",),
            ("b", lr("TOTAL", "Rs. " + money(1231))),
            ("=",),
            ("c", "You saved Rs. 69.00 on MRP!"),
            ("c", "Thank you, aavjo!"),
            ("small", "Demo bill made for BillSahi"),
        ],
    }
)

# ───────────────────────── rendering ─────────────────────────


def render(lines, seed: int) -> Image.Image:
    rnd = random.Random(seed)
    size = 21
    font = ImageFont.truetype(MONO, size)
    bold = ImageFont.truetype(MONO_BOLD, size)
    big = ImageFont.truetype(MONO_BOLD, 26)
    small = ImageFont.truetype(MONO, 15)
    cw = font.getlength("M")
    line_h = 30
    pad_x, pad_y = 30, 40
    width = int(cw * COLS + pad_x * 2)
    height = pad_y * 2 + line_h * len(lines) + 30

    paper = Image.new("RGB", (width, height), (250, 249, 245))
    d = ImageDraw.Draw(paper)
    y = pad_y
    ink = (52, 52, 58)
    for spec in lines:
        kind = spec[0]
        if kind in ("-", "="):
            d.text((pad_x, y), kind * COLS, font=font, fill=(110, 110, 115))
        elif kind == "big":
            w = big.getlength(spec[1])
            d.text(((width - w) / 2, y - 4), spec[1], font=big, fill=(30, 30, 34))
            y += 6
        elif kind == "small":
            w = small.getlength(spec[1])
            d.text(((width - w) / 2, y + 6), spec[1], font=small, fill=(140, 140, 145))
        elif kind == "c":
            text = spec[1]
            w = font.getlength(text)
            d.text(((width - w) / 2, y), text, font=font, fill=ink)
        elif kind == "b":
            d.text((pad_x, y), spec[1], font=bold, fill=(30, 30, 34))
        else:
            d.text((pad_x, y), spec[1], font=font, fill=ink)
        y += line_h

    # thermal-paper feel: faint speckle + a softer print head
    px = paper.load()
    for _ in range(width * height // 90):
        x, yy = rnd.randrange(width), rnd.randrange(height)
        v = rnd.randint(228, 246)
        px[x, yy] = (v, v, v - 3)
    paper = paper.filter(ImageFilter.GaussianBlur(0.45))

    # torn zig-zag bottom edge
    mask = Image.new("L", paper.size, 255)
    md = ImageDraw.Draw(mask)
    tooth = 12
    pts = [(0, height)]
    for x in range(0, width + tooth, tooth):
        pts.append((x, height - (6 if (x // tooth) % 2 else 0)))
    pts.append((width, height))
    md.polygon(pts, fill=0)

    # place on a "table" like a phone photo, slightly rotated
    table = Image.new("RGB", (width + 140, height + 140), (92, 74, 60))
    td = ImageDraw.Draw(table)
    for i in range(0, table.size[1], 7):
        shade = 86 + rnd.randint(-6, 6)
        td.line([(0, i), (table.size[0], i + rnd.randint(-3, 3))], fill=(shade + 8, shade - 6, shade - 18), width=4)
    shadow = Image.new("RGBA", paper.size, (0, 0, 0, 90))
    angle = rnd.uniform(-1.4, 1.4)
    paper_rgba = paper.convert("RGBA")
    paper_rgba.putalpha(mask)
    rot = paper_rgba.rotate(angle, expand=True, resample=Image.BICUBIC)
    sh = shadow.copy()
    sh.putalpha(Image.eval(mask, lambda a: 90 if a else 0))
    sh = sh.rotate(angle, expand=True).filter(ImageFilter.GaussianBlur(8))
    ox = (table.size[0] - rot.size[0]) // 2
    oy = (table.size[1] - rot.size[1]) // 2
    table.paste(sh, (ox + 8, oy + 10), sh)
    table.paste(rot, (ox, oy), rot)
    return table


if __name__ == "__main__":
    index = []
    for n, s in enumerate(SAMPLES):
        img = render(s["lines"], seed=n + 7)
        img.save(OUT / f"{s['slug']}.jpg", quality=86)
        (OUT / f"{s['slug']}.json").write_text(json.dumps(s["bill"], indent=2, ensure_ascii=False) + "\n")
        index.append({"slug": s["slug"], "label": s["label"], "merchant": s["bill"]["merchantName"]})
        print(s["slug"], img.size, s["bill"]["gstin"])
    (OUT / "index.json").write_text(json.dumps(index, indent=2) + "\n")
