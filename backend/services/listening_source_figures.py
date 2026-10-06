"""Digest-bound GPT figures; only authenticated source-block reads sign them."""
from functools import lru_cache
import hashlib
import json
from pathlib import Path

CONTENT = Path(__file__).resolve().parents[1] / "content/listening/80-days-generated-figures-v1.json"


@lru_cache(maxsize=1)
def figure_catalog() -> dict:
    catalog = json.loads(CONTENT.read_text(encoding="utf-8"))
    if catalog.get("schema") != "80-days-generated-figures/1":
        raise ValueError("Invalid generated figure catalog")
    for asset in catalog["figures"].values():
        expected = f"source-collections/{catalog['package_id']}/{catalog['manifest_sha256']}/figures/gpt-v1/{asset['sha256']}.png"
        if asset["storage_path"] != expected or len(asset["sha256"]) != 64:
            raise ValueError("Invalid generated figure binding")
    return catalog


def signed_figures(native: dict, manifest_sha256: str, signer) -> list[dict]:
    catalog = figure_catalog()
    if manifest_sha256 != catalog["manifest_sha256"]:
        raise ValueError("Generated figures do not match this source revision")
    images = []
    for figure in native["figures"]:
        asset = catalog["figures"].get(figure["figure_id"])
        if not asset or hashlib.sha256(figure["svg"].encode()).hexdigest() != asset["source_svg_sha256"]:
            raise ValueError("Generated figure does not match its reviewed reference")
        images.append({"asset_id": "gpt-v1:" + figure["figure_id"], "url": signer(asset["storage_path"]) or "",
                       "width": asset["width"], "height": asset["height"],
                       "alt_vi": figure["alt_vi"].removeprefix("Hình vẽ lại từ đề gốc. ")})
    return images
