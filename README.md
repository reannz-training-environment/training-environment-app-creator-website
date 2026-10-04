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

Members of the organisation and its outside collaborators have their requests
built straight away; anyone else's wait for a maintainer.

The app creator reads the spec back out of the issue, so the issue body must
stay in the shape GitHub gives a form's field: `### App spec`, then the YAML in
a fenced block.

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

GitHub Pages publishes `main` as it is; there is no build step.
