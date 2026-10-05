#!/usr/bin/env python3
"""Build the package lists the website's package boxes suggest from.

Writes assets/catalogue/<list>.json for each list, and versions.json with the
Python and R versions Mahuika has. The Catalogue workflow runs this every week
and commits what changed. Each list is built on its own: one whose source
cannot be reached keeps its last copy, and the script exits 1 after building
the others.

A list is {"title", "source", "updated", "count", "items"}, where each item is
[name, version, summary, popularity], popularity being downloads (or a
download score) where the source has them, else 0. Lists with popularity are
sorted by it, the rest by name.

    python3 tools/build_catalogue.py [--only bioconda,cran] [--out assets/catalogue]
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime
import gzip
import html
import json
import lzma
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets" / "catalogue"
AGENT = "reannz-training-environment-app-creator-catalogue (+https://github.com/reannz-training-environment)"
SUMMARY = 140  # longest summary kept


def fetch(url: str, attempts: int = 4) -> bytes:
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": AGENT})
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(2 * (attempt + 1))
    raise AssertionError("unreachable")


def fetch_json(url: str):
    return json.loads(fetch(url))


def summary(text: str | None) -> str:
    text = re.sub(r"\s+", " ", html.unescape(text or "")).strip()
    return text if len(text) <= SUMMARY else text[: SUMMARY - 1].rstrip() + "…"


def runnable(info: dict) -> bool:
    """A conda package with a build the images can install."""
    return bool({"linux-64", "noarch"} & set(info.get("subdirs") or []))


# ----------------------------------------------------------------- conda


def channel(name: str) -> dict:
    return fetch_json(f"https://conda.anaconda.org/{name}/channeldata.json")["packages"]


# R packages have their own lists, for the RStudio app
def not_r(name: str) -> bool:
    return not name.startswith(("bioconductor-", "r-"))


def bioconda(cache: dict) -> dict:
    packages = cache.setdefault("bioconda", channel("bioconda"))
    items = [
        [name, info.get("version") or "", summary(info.get("summary")), 0]
        for name, info in packages.items()
        if runnable(info) and not_r(name)
    ]
    return {"title": "Bioinformatics tools from bioconda", "source": "https://bioconda.github.io", "items": sorted(items)}


# Workflow managers and their helpers, as conda names, in the order the list
# shows them. Others whose summary says they manage workflows are added.
WORKFLOWS = [
    "nextflow", "nf-core", "nf-test", "snakemake", "snakemake-minimal", "snakedeploy", "snakefmt",
    "snakemake-executor-plugin-slurm", "snakemake-wrapper-utils", "cwltool", "cwl-utils", "toil",
    "cromwell", "womtool", "miniwdl", "cromshell", "cylc-flow", "metomi-rose", "parsl", "dask",
    "dask-jobqueue", "luigi", "prefect", "apache-airflow", "ruffus", "bpipe", "doit", "fireworks",
    "maestrowf", "ndcctools", "radical.pilot", "aiida-core", "signac", "signac-flow", "nipype", "pydra",
    "papermill", "ploomber", "kedro", "dvc", "mlflow", "metaflow", "flytekit", "jug", "invoke", "just",
    "make", "galaxy-tool-util", "planemo", "pypiper", "looper", "arvados-cwl-runner", "streamflow",
]
WORKFLOW_WORDS = re.compile(
    r"workflow (management|manager|engine|system|language|framework|runner|tool)|"
    r"pipeline (framework|engine|manager|management)|workflow management|scientific workflows",
    re.I,
)


def workflows(cache: dict) -> dict:
    channels = {
        "bioconda": cache.setdefault("bioconda", channel("bioconda")),
        "conda-forge": cache.setdefault("conda-forge", channel("conda-forge")),
    }

    def find(name: str):
        for source, packages in channels.items():
            info = packages.get(name)
            if info and runnable(info):
                return source, info
        return None

    items, seen = [], set()
    for name in WORKFLOWS:
        found = find(name)
        if found:
            items.append([name, found[1].get("version") or "", summary(found[1].get("summary")), 0])
            seen.add(name)
    extra = []
    for source, packages in channels.items():
        for name, info in packages.items():
            if name in seen or not runnable(info) or not not_r(name):
                continue
            if name.startswith(("snakemake-executor-plugin-", "snakemake-storage-plugin-", "nf-")) or WORKFLOW_WORDS.search(
                f"{info.get('summary') or ''} {info.get('description') or ''}"[:2000]
            ):
                extra.append([name, info.get("version") or "", summary(info.get("summary")), 0])
                seen.add(name)
    return {
        "title": "Workflow managers, from conda-forge and bioconda",
        "source": "https://conda-forge.org",
        "items": items + sorted(extra),
        "sorted": "curated",
    }


# ------------------------------------------------------------------ PyPI


def pypi(cache: dict) -> dict:
    data = fetch_json("https://hugovk.github.io/top-pypi-packages/top-pypi-packages.min.json")
    items = [[row["project"], "", "", int(row["download_count"])] for row in data["rows"]]
    return {
        "title": "The 15,000 most downloaded Python packages on PyPI",
        "source": "https://hugovk.github.io/top-pypi-packages/",
        "popularity": "downloads in the last 30 days",
        "items": items,
    }


# ------------------------------------------------------------------- CRAN


def cran(cache: dict) -> dict:
    page = fetch("https://cran.r-project.org/web/packages/available_packages_by_name.html").decode("utf-8")
    titles = {
        name: summary(re.sub(r"<[^>]+>", "", title))
        for name, title in re.findall(
            r'<a href="[^"]*/packages/([^/"]+)/index\.html"><span class="CRAN">[^<]*</span></a></td><td>(.*?)</td>',
            page,
            re.S,
        )
    }
    versions = {}
    for paragraph in fetch("https://cran.r-project.org/src/contrib/PACKAGES").decode("utf-8", "replace").split("\n\n"):
        fields = dict(re.findall(r"^([A-Za-z]+): (.*)$", paragraph, re.M))
        if "Package" in fields:
            versions[fields["Package"]] = fields.get("Version", "")
    names = sorted(set(titles) | set(versions))
    downloads: dict[str, int] = {}

    def count(batch: list[str]) -> dict[str, int]:
        rows = fetch_json("https://cranlogs.r-pkg.org/downloads/total/last-month/" + ",".join(batch))
        return {row["package"]: int(row.get("downloads") or 0) for row in rows}

    batches = [names[i : i + 250] for i in range(0, len(names), 250)]
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        for result in pool.map(count, batches):
            downloads.update(result)
    items = [[n, versions.get(n, ""), titles.get(n, ""), downloads.get(n, 0)] for n in names]
    return {
        "title": "Every package on CRAN",
        "source": "https://cran.r-project.org",
        "popularity": "downloads from RStudio's CRAN mirror in the last month",
        "items": items,
    }


# ----------------------------------------------------------- Bioconductor


def bioconductor(cache: dict) -> dict:
    config = fetch("https://bioconductor.org/config.yaml").decode()
    release = re.search(r'^release_version: "?([0-9.]+)"?', config, re.M).group(1)
    kinds = {
        "bioc": ("software", "bioc/bioc_pkg_scores.tab"),
        "data/annotation": ("annotation", "data-annotation/annotation_pkg_scores.tab"),
        "data/experiment": ("experiment data", "data-experiment/experiment_pkg_scores.tab"),
        "workflows": ("workflow", "workflows/workflows_pkg_scores.tab"),
    }
    items = []
    for path, (kind, scores_path) in kinds.items():
        packages = fetch_json(f"https://bioconductor.org/packages/json/{release}/{path}/packages.json")
        scores = {}
        for line in fetch(f"https://bioconductor.org/packages/stats/{scores_path}").decode().splitlines()[1:]:
            name, _, score = line.partition("\t")
            if score.strip().isdigit():
                scores[name] = int(score)
        for name, info in packages.items():
            title = summary(info.get("Title"))
            if kind != "software":
                title = f"({kind}) {title}"
            items.append([name, info.get("Version") or "", title, scores.get(name, 0)])
    return {
        "title": f"Every Bioconductor {release} package",
        "source": "https://bioconductor.org",
        "popularity": "Bioconductor's download score",
        "items": items,
    }


# -------------------------------------------------------------------- apt

UBUNTU = "jammy"  # the JupyterLab and VS Code images' Ubuntu, 22.04


def apt(cache: dict) -> dict:
    found: dict[str, list] = {}
    for component in ("main", "universe"):
        text = lzma.decompress(
            fetch(f"http://archive.ubuntu.com/ubuntu/dists/{UBUNTU}/{component}/binary-amd64/Packages.xz")
        ).decode("utf-8", "replace")
        for paragraph in text.split("\n\n"):
            fields = dict(re.findall(r"^([A-Za-z-]+): (.*)$", paragraph, re.M))
            name = fields.get("Package")
            if not name or name.endswith(("-dbg", "-dbgsym")) or fields.get("Section", "").endswith(("debug", "translations")):
                continue
            # without its version, which is long and changes with every update
            found[name] = [name, "", summary(fields.get("Description")), 0]
    # Ubuntu no longer counts installs; Debian's counts rank the same packages
    for line in gzip.decompress(fetch("https://popcon.debian.org/by_inst.gz")).decode("utf-8", "replace").splitlines():
        parts = line.split()
        if len(parts) > 2 and parts[0].isdigit() and parts[1] in found:
            found[parts[1]][3] = int(parts[2])
    return {
        "title": "Every Ubuntu 22.04 package (main and universe)",
        "source": "https://packages.ubuntu.com/jammy/",
        "popularity": "installs counted by Debian's popularity contest",
        "items": list(found.values()),
    }


# -------------------------------------------------------------- Open VSX


def vscode(cache: dict) -> dict:
    # Open VSX's search stops at 10,000 results, so the list is read from both
    # ends: most downloaded first, then least
    items, seen, total = [], set(), 0
    for order in ("desc", "asc"):
        for offset in range(0, 10000, 100):
            query = urllib.parse.urlencode(
                {"size": 100, "offset": offset, "sortBy": "downloadCount", "sortOrder": order, "includeAllVersions": "false"}
            )
            page = fetch_json(f"https://open-vsx.org/api/-/search?{query}")
            total = int(page.get("totalSize") or total)
            for e in page.get("extensions", []):
                ident = f"{e['namespace']}.{e['name']}"
                if ident in seen:
                    continue
                seen.add(ident)
                if e.get("deprecated"):
                    continue
                label = e.get("displayName") or ""
                text = f"{label}: {e.get('description') or ''}" if label else e.get("description") or ""
                items.append([ident, e.get("version") or "", summary(text), int(e.get("downloadCount") or 0)])
            if not page.get("extensions") or len(seen) >= total:
                break
        if len(seen) >= total:
            break
    return {
        "title": "Every VS Code extension on Open VSX",
        "source": "https://open-vsx.org",
        "popularity": "downloads",
        "items": items,
    }


# --------------------------------------------------------- Mahuika versions


def module_versions(url: str, module: str) -> dict:
    """The versions of a module NeSI's docs list, without their toolchains."""
    page = fetch(url).decode("utf-8")
    section = page[page.index('id="available-modules"') :]
    found = re.findall(rf"changeVersion\('{re.escape(module)}','([^']+)'\)", section.split("</nav>", 1)[0])
    default = re.search(rf"title='Default Version'\s*onclick=\"changeVersion\('{re.escape(module)}','([^']+)'\)", section)
    versions = sorted({v.split("-", 1)[0] for v in found}, key=lambda v: [int(p) for p in v.split(".")], reverse=True)
    if not versions:
        raise ValueError(f"no {module} versions found on {url}")
    return {"versions": versions, "default": default.group(1).split("-", 1)[0] if default else versions[0], "source": url}


def versions(cache: dict) -> dict:
    return {
        "python": module_versions("https://docs.nesi.org.nz/Software/Available_Applications/Python/", "Python"),
        "r": module_versions("https://docs.nesi.org.nz/Software/Available_Applications/R/", "R"),
    }


LISTS = {
    "bioconda": bioconda,
    "workflows": workflows,
    "pypi": pypi,
    "cran": cran,
    "bioconductor": bioconductor,
    "apt": apt,
    "vscode": vscode,
    "versions": versions,
}


def rounded(n: int) -> int:
    """Two significant figures: all the page shows, and steadier from one
    week to the next, so the weekly commit changes less."""
    return n if n < 100 else int(float(f"{n:.2g}"))


def write(out: Path, name: str, data: dict) -> None:
    if name != "versions":
        items = [[n, v, s, rounded(p)] for n, v, s, p in data["items"]]
        if data.get("sorted") != "curated":
            if any(item[3] for item in items):
                items.sort(key=lambda item: (-item[3], item[0].lower()))
            else:
                items.sort(key=lambda item: item[0].lower())
        data = {**{k: v for k, v in data.items() if k != "sorted"}, "count": len(items), "items": items}
    path = out / f"{name}.json"
    # a list that has not changed keeps its file, and the date it last changed
    try:
        before = json.loads(path.read_text(encoding="utf-8"))
        if {k: v for k, v in before.items() if k != "updated"} == data:
            print(f"{path.name}: unchanged")
            return
    except (OSError, ValueError):
        pass
    data = {**data, "updated": datetime.date.today().isoformat()}
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{path.name}: {data.get('count', '')} {path.stat().st_size // 1024} KiB")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", help="comma separated lists to build (default: all)")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args(argv)
    names = args.only.split(",") if args.only else list(LISTS)
    args.out.mkdir(parents=True, exist_ok=True)
    cache: dict = {}
    failed = []
    for name in names:
        try:
            write(args.out, name, LISTS[name](cache))
        except Exception as exc:  # keep the last good copy, and build the rest
            print(f"{name}: FAILED: {exc}", file=sys.stderr)
            failed.append(name)
    if failed:
        print(f"could not build: {', '.join(failed)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
