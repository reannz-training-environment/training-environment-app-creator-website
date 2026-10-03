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
one field is the app spec. The page is static, with no server of its own, so:

* **Without a token** it opens that form on GitHub with everything filled in
  (`issues/new?template=app-request.yml&spec=...`), and the trainer presses
  **Create**. Anyone in the organisation can, with read access.
* **With a token** (a fine-grained token with Issues write access to the app
  creator repository) it files the issue itself through the GitHub API, so
  there is nothing to press on GitHub. The token stays in the browser, and is
  sent only to `api.github.com`.

The app creator reads the spec back out of the issue, so the issue body must
stay in the shape GitHub gives a form's field: `### App spec`, then the YAML in
a fenced block.

## Space needed

The panel estimates the space the app needs: the data each learner gets in
their home directory (and so the home directories' total, for a number of
learners), and the image each worker node stores. Data from a GitHub
repository is sized exactly, from the sizes of the repository's files at the
chosen ref; a download from a GitHub release from the release; other downloads
only if their server answers the page. Software is estimated from `TYPICAL` in
`assets/app.js`, sizes measured on images the app creator built; update them
from the Validate workflow's measurements when the templates change. The pull
request's checks measure every image exactly.

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
| `assets/vendor/js-yaml.min.js` | [js-yaml](https://github.com/nodeca/js-yaml) 4.1.0 (MIT), to write and read YAML |

GitHub Pages publishes `main` as it is; there is no build step.
