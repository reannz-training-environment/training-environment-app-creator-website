# Training environment app creator website

The form that starts a new REANNZ training environment app:
<https://reannz-training-environment.github.io/training-environment-app-creator-website/>

A trainer describes the workshop environment (name, interfaces, emulated
GPUs, Slurm and Lmod, data and software) and presses one button. That files a
request with
[training-environment-app-creator](https://github.com/reannz-training-environment/training-environment-app-creator),
which does everything after that. It opens the pull request adding
`apps/<name>.yml`, test-builds the images and asks a maintainer to approve.
Once the pull request is merged, it creates the app repositories and builds
their images. Its README explains how.

## How the page sends the request

A request is an issue made with the app creator's *Request an app* form, whose
one field is the app spec.

* **Signed in with GitHub**, the page files the issue itself, as the trainer,
  so there is nothing to press on GitHub. The first press of the button sends
  them to GitHub to sign in; the first time, GitHub asks them to authorise the
  app creator. The sign-in lasts 8 hours in that tab, after which GitHub signs
  them in again without asking. Signing in needs the
  [sign-in helper](sign-in/README.md): until `SIGN_IN` in `assets/app.js` names
  it, the page works as below.
* **Not signed in**, the page opens the form on GitHub with everything filled
  in (`issues/new?template=app-request.yml&spec=...`), and the trainer presses
  **Create**. This is also the fallback if signing in fails.

A maintainer accepts each request before the app creator builds it.

The app creator reads the spec back out of the issue, so the issue body must
stay in the shape GitHub gives a form's field: `### App spec`, then the YAML in
a fenced block.

## Popular packages and suggestions

*Popular packages*, in the Software section, has a tab for each kind of
package, with a few dozen chosen packages to add with a click; a second click
takes one out. For anything else, a package box suggests packages as their
names are typed, from every package of its kind: the name itself first, then
popular ones, then the most downloaded. Up and down choose a suggestion, Enter
or Tab takes it, and Escape closes the list. Anything not suggested can still
be typed.

| Tab | Box | Suggests from | Ranked by |
| --- | --- | --- | --- |
| Bioinformatics, Workflows | Conda packages | every [bioconda](https://bioconda.github.io) tool (except its R packages), and workflow managers from conda-forge and bioconda | popular first, then shortest |
| Python | Python packages (pip) | the [15,000 most downloaded](https://hugovk.github.io/top-pypi-packages/) PyPI packages | downloads |
| R | R packages: CRAN | every CRAN package | downloads |
| Bioconductor | R packages: Bioconductor | every package of the current Bioconductor release | download score |
| Command line | System packages (apt) | every Ubuntu 22.04 package in main and universe (the JupyterLab and VS Code images' Ubuntu) | installs counted by Debian |
| VS Code | VS Code extensions | every extension on [Open VSX](https://open-vsx.org) | downloads |

The popular packages are chosen by hand, in `LISTS` in `assets/app.js`: the
most downloaded packages are mostly ones other packages depend on, rather
than what a workshop would ask for.

The lists behind the suggestions are JSON files in `assets/catalogue/`, built
by `tools/build_catalogue.py`. A box loads its lists the first time it is
used. The **Catalogue** workflow rebuilds them every Monday and commits the
ones that changed; run it by hand (*Actions*, *Catalogue*, *Run workflow*) to
update them sooner.

## GPU and CPU builds

Some programs come as a build for real (CUDA) GPUs and a build for CPUs:
TensorFlow, JAX, CuPy, Faiss, RAPIDS and PyTorch from PyPI among them. The
training environment's GPUs are emulated and have no CUDA. Code runs on them
only through the emulator's PyTorch and Numba's CUDA simulator, which the
*Emulated GPUs* options install. So the page warns when a package box asks
for a CUDA build: it cannot use the emulated GPUs, or any GPU if the app has
none, and it makes the image larger. With emulated GPUs it also says which
packages are CPU builds, which run without them, and suggestions are tagged
*CUDA build* or *CPU build*. These are warnings: the request can still be
made. The app creator gives the same warnings on the pull request
(`gpu_build` in its `spec.py`).

## Python and R versions

The Python and R menus under *Advanced* offer the versions Mahuika has, as
[NeSI's documentation](https://docs.nesi.org.nz/Software/Available_Applications/Python/)
lists them; the Catalogue workflow reads them into
`assets/catalogue/versions.json` each week, so new ones appear by themselves.
Python 2.7 is left out, since JupyterLab and pip no longer run on it. The app
creator's README explains how each version is installed.

## Space needed

The page does not estimate the space an app needs. The app creator measures
it exactly when it test-builds the request's images: each image, and the data
every learner gets in their home directory. It shows the result on the
request and on its pull request.

## Checking

The page checks the spec with the same rules as the app creator's
[schema](https://github.com/reannz-training-environment/training-environment-app-creator/blob/main/schema/app.schema.json),
so most mistakes are caught while typing. The app creator checks again when it
reads the request, so if the two ever disagree, the schema wins: update the
patterns in `assets/app.js` to match it.

## Working on it

```bash
python3 -m http.server 8000      # then open http://localhost:8000
```

| File | |
| --- | --- |
| `index.html` | the form |
| `assets/app.js` | builds the spec, checks it, and sends the request |
| `assets/app.css` | styles, light and dark |
| `sign-in/worker.js` | the sign-in helper, which runs on Cloudflare Workers, not here ([setting it up](sign-in/README.md)) |
| `assets/vendor/js-yaml.min.js` | [js-yaml](https://github.com/nodeca/js-yaml) 4.1.0 (MIT), to write and read YAML |
| `assets/catalogue/` | the lists the package boxes suggest from, and Mahuika's Python and R versions |
| `tools/build_catalogue.py` | builds them; the Catalogue workflow runs it weekly |

GitHub Pages publishes `main` as it is; there is no build step.
