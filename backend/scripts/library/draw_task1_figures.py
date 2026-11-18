"""Draw the Task 1 figures missing from three Writing sample sets (G06-T19).

``task1_bricks``, ``task1_internet`` and ``task1_island`` have no image in the
source project. Each figure is drawn only from the ``data`` field of its own
set (stages, series, map elements); nothing is copied from a book and no
number is added. Output: light-background PNGs (< 2 MB) in
``backend/content/library/figures/``, referenced by the manifest's
``overrides.image_path``.

Needs matplotlib (not a backend runtime dependency):

    pip install matplotlib
    cd backend
    python -m scripts.library.draw_task1_figures --source "<ielts-pipeline>/incoming"

The script reads the source sets and never writes to the source project.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Ellipse, FancyArrowPatch, FancyBboxPatch, Rectangle  # noqa: E402

OUT_DIR = Path(__file__).resolve().parents[2] / "content" / "library" / "figures"
DPI = 150
INK = "#111111"
GREY = "#6b6b6b"
PAPER = "#ffffff"
plt.rcParams.update({"font.family": "DejaVu Sans", "text.color": INK,
                     "axes.edgecolor": INK, "axes.labelcolor": INK,
                     "xtick.color": INK, "ytick.color": INK,
                     "savefig.facecolor": PAPER, "figure.facecolor": PAPER})


def _load(source: Path, key: str) -> dict:
    return json.loads((source / f"{key}.json").read_text(encoding="utf-8"))["data"]


# ── task1_bricks: process diagram ────────────────────────────────────────────

def draw_bricks(data: dict, out: Path) -> None:
    stages = data["stages"]
    assert len(stages) == 7, "bricks: expected 7 stages"
    fig, ax = plt.subplots(figsize=(12, 6.6))
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 6.6)
    ax.axis("off")
    ax.text(6, 6.15, "How bricks are manufactured", ha="center", va="center",
            fontsize=20, fontweight="bold")
    w, h = 2.45, 1.75
    top = [(0.4 + i * 2.95, 3.55) for i in range(4)]            # stages 1–4, left → right
    bottom = [(0.4 + i * 2.95, 0.75) for i in (3, 2, 1)]        # stages 5–7, right → left
    boxes = top + bottom
    for i, ((x, y), text) in enumerate(zip(boxes, stages), start=1):
        ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.04,rounding_size=0.12",
                                    fc="#f6f6f6", ec=INK, lw=1.6))
        ax.text(x + 0.18, y + h - 0.28, str(i), fontsize=15, fontweight="bold", va="center")
        ax.text(x + w / 2, y + h / 2 - 0.12, _wrap(text, 24), ha="center", va="center",
                fontsize=11.5, linespacing=1.35)

    def arrow(p, q):
        ax.add_patch(FancyArrowPatch(p, q, arrowstyle="-|>", mutation_scale=18, lw=1.8, color=INK))

    for i in range(3):                                   # 1→2→3→4
        (x, y), (nx, _) = boxes[i], boxes[i + 1]
        arrow((x + w + 0.05, y + h / 2), (nx - 0.05, y + h / 2))
    x4, y4 = boxes[3]                                    # 4 ↓ 5
    arrow((x4 + w / 2, y4 - 0.05), (x4 + w / 2, boxes[4][1] + h + 0.05))
    for i in range(4, 6):                                # 5→6→7 (leftwards)
        (x, y), (nx, _) = boxes[i], boxes[i + 1]
        arrow((x - 0.05, y + h / 2), (nx + w + 0.05, y + h / 2))
    fig.savefig(out, dpi=DPI, bbox_inches="tight", pad_inches=0.25)
    plt.close(fig)


def _wrap(text: str, width: int) -> str:
    words, lines, cur = text.split(), [], ""
    for word in words:
        if cur and len(cur) + 1 + len(word) > width:
            lines.append(cur)
            cur = word
        else:
            cur = f"{cur} {word}".strip()
    lines.append(cur)
    return "\n".join(lines)


# ── task1_internet: line graph ───────────────────────────────────────────────

def draw_internet(data: dict, out: Path) -> None:
    years, series = data["years"], data["series"]
    styles = {"UK": ("-", "o", INK), "France": ("--", "s", GREY), "Germany": (":", "^", INK)}
    fig, ax = plt.subplots(figsize=(10, 6.4))
    for name, values in series.items():
        ls, marker, colour = styles.get(name, ("-", "o", INK))
        ax.plot(years, values, ls=ls, marker=marker, color=colour, lw=2.2, ms=8, label=name)
    ax.set_title(data["title"].replace("-", "–"), fontsize=17, fontweight="bold", pad=14)
    ax.set_xlabel("Year", fontsize=13)
    ax.set_ylabel("Households with internet access (%)", fontsize=13)
    ax.set_xticks(years)
    ax.set_ylim(0, 100)
    ax.set_yticks(range(0, 101, 10))
    ax.set_xlim(years[0] - 1, years[-1] + 1)
    ax.grid(True, ls="--", lw=0.6, color="#cccccc")
    ax.spines[["top", "right"]].set_visible(False)
    ax.tick_params(labelsize=12)
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.13), ncol=len(series), frameon=True,
              fontsize=12, edgecolor=INK)
    fig.savefig(out, dpi=DPI, bbox_inches="tight", pad_inches=0.25)
    plt.close(fig)


# ── task1_island: two maps ───────────────────────────────────────────────────

def _island_base(ax, title: str, trees_west: bool) -> None:
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 8)
    ax.set_aspect("equal")
    ax.axis("off")
    ax.add_patch(Rectangle((0, 0), 10, 8, fc="#eef3f7", ec=INK, lw=1.2))           # sea
    ax.add_patch(Ellipse((5.2, 4.1), 8.0, 5.6, fc="#ffffff", ec=INK, lw=1.8))      # island
    ax.add_patch(Ellipse((1.55, 4.1), 1.0, 3.2, fc="#efe6cf", ec=GREY, lw=1.0))    # west beach
    ax.text(1.55, 4.1, "beach", rotation=90, ha="center", va="center", fontsize=10)
    ax.text(5, 7.55, title, ha="center", va="center", fontsize=15, fontweight="bold")
    ax.text(9.3, 0.5, "Sea", fontsize=10, color=GREY, ha="center")
    ax.annotate("", xy=(9.3, 7.4), xytext=(9.3, 6.6),
                arrowprops=dict(arrowstyle="-|>", color=INK, lw=1.5))
    ax.text(9.3, 7.55, "N", ha="center", va="bottom", fontsize=11, fontweight="bold")
    east = [(7.6, 5.4), (8.3, 4.6), (7.5, 4.3), (8.2, 3.5), (7.2, 3.0), (6.5, 2.4), (7.6, 2.3),
            (6.4, 3.4)]
    west = [(2.6, 5.4), (3.3, 6.0), (4.1, 5.4), (3.0, 3.3), (3.8, 2.4), (4.6, 2.0), (2.7, 2.6),
            (4.6, 6.1), (5.4, 2.0)]
    for x, y in east + (west if trees_west else []):
        _tree(ax, x, y)


def _tree(ax, x: float, y: float) -> None:
    ax.add_patch(Ellipse((x, y), 0.42, 0.42, fc="#d9d9d9", ec=INK, lw=0.9))


def _hut(ax, x: float, y: float) -> None:
    ax.add_patch(Rectangle((x - 0.13, y - 0.11), 0.26, 0.22, fc="#ffffff", ec=INK, lw=1.0))


def draw_island(data: dict, out: Path) -> None:
    # Elements come from data["elements"]: reception (centre), restaurant
    # (west of reception), two hut clusters (west and east), vehicle track,
    # pier (south), footpaths from huts to the beach, roped-off swimming area
    # off the west beach, trees kept in the eastern half.
    fig, (left, right) = plt.subplots(1, 2, figsize=(15, 6.6))
    _island_base(left, "Before", trees_west=True)
    _island_base(right, "After", trees_west=False)

    ax = right
    ax.add_patch(Rectangle((4.55, 3.7), 0.9, 0.7, fc="#ffffff", ec=INK, lw=1.6))
    ax.text(5.0, 4.05, "Reception", ha="center", va="center", fontsize=8.5)
    ax.add_patch(Rectangle((2.65, 3.75), 0.95, 0.6, fc="#ffffff", ec=INK, lw=1.6))
    ax.text(3.12, 4.05, "Restaurant", ha="center", va="center", fontsize=8.5)
    west_huts = [(3.0, 5.6), (3.5, 5.75), (4.0, 5.6), (3.25, 5.2), (3.75, 5.2)]
    east_huts = [(5.9, 5.6), (6.4, 5.75), (6.9, 5.6), (6.15, 5.2), (6.65, 5.2)]
    for x, y in west_huts + east_huts:
        _hut(ax, x, y)
    ax.text(3.5, 5.97, "Accommodation huts", ha="center", fontsize=9)
    ax.text(6.4, 5.97, "Accommodation huts", ha="center", fontsize=9)
    track = dict(color=INK, lw=3.2, solid_capstyle="round")
    ax.plot([3.6, 4.55], [4.05, 4.05], **track)                  # restaurant – reception
    ax.plot([5.0, 5.0, 3.5, 3.5], [4.4, 4.75, 4.75, 5.05], **track)  # reception – west huts
    ax.plot([5.0, 6.4, 6.4], [4.75, 4.75, 5.05], **track)        # reception – east huts
    ax.plot([5.0, 5.0], [3.7, 1.45], **track)                    # reception – pier
    ax.text(5.15, 2.6, "Vehicle track", fontsize=9, rotation=90, va="center")
    ax.add_patch(Rectangle((4.85, 0.35), 0.3, 1.1, fc="#ffffff", ec=INK, lw=1.6))
    ax.text(5.35, 0.75, "Pier", fontsize=10, va="center")
    path = dict(color=INK, lw=1.3, ls=(0, (2, 2)))
    ax.plot([3.0, 2.05], [5.45, 4.9], **path)                    # west huts → beach
    ax.plot([5.75, 5.6, 3.3, 2.05], [5.6, 6.4, 6.4, 5.3], **path)  # east huts → beach
    ax.text(4.45, 6.5, "Footpaths", ha="center", fontsize=9)
    ax.add_patch(Rectangle((0.35, 3.3), 0.55, 1.6, fc="none", ec=INK, lw=1.2, ls=(0, (4, 2))))
    ax.text(0.62, 2.95, "Swimming\narea", ha="center", va="top", fontsize=8.5)

    left.text(5.4, 4.0, "Trees", fontsize=10, ha="center")
    right.text(8.0, 2.55, "Trees", fontsize=10, ha="center")
    fig.tight_layout()
    fig.savefig(out, dpi=DPI, bbox_inches="tight", pad_inches=0.2)
    plt.close(fig)


DRAWERS = {"task1_bricks": draw_bricks, "task1_internet": draw_internet, "task1_island": draw_island}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--source", type=Path, required=True, help="ielts-pipeline incoming/ folder")
    parser.add_argument("--out", type=Path, default=OUT_DIR)
    args = parser.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    for key, draw in DRAWERS.items():
        target = args.out / f"{key}.png"
        draw(_load(args.source, key), target)
        size = target.stat().st_size
        if size > 2 * 1024 * 1024:
            print(f"{target} is {size} bytes (> 2 MB)", file=sys.stderr)
            return 1
        print(f"WROTE {target} ({size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
