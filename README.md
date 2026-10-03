# Training environment app creator website

The form that starts a new REANNZ training environment app:
<https://reannz-training-environment.github.io/training-environment-app-creator-website/>

A trainer describes the workshop environment (name, interfaces, emulated
GPUs, Slurm and Lmod, data and software), and the page opens a pull request
adding `apps/<name>.yml` to
[training-environment-app-creator](https://github.com/reannz-training-environment/training-environment-app-creator).
Everything after that - checking the spec, test-building the images, and
creating the app repositories when the pull request is merged - happens there;
its README explains how.

## How the page opens the pull request

The page is static, with no server of its own:

* **Without a token** it opens GitHub's editor with the file filled in, and the
  user commits it to a new branch and opens the pull request there. They need
  write access to the app creator repository.
* **With a token** (a fine-grained token with Contents and Pull requests write
  access to the app creator repository) it makes the branch, the file and the
  pull request itself through the GitHub API, and can load an existing app to
  edit. The token stays in the browser, and is sent only to `api.github.com`.

The page checks the spec with the same rules as the app creator's
[schema](https://github.com/reannz-training-environment/training-environment-app-creator/blob/main/schema/app.schema.json),
so most mistakes are caught while typing. The app creator checks again before a
pull request can be merged, so if the two ever disagree, the schema wins:
update the patterns in `assets/app.js` to match it.

## Working on it

```bash
python3 -m http.server 8000      # then open http://localhost:8000
```

| File | |
| --- | --- |
| `index.html` | the form |
| `assets/app.js` | builds the spec, checks it, and opens the pull request |
| `assets/app.css` | styles, light and dark |
| `assets/vendor/js-yaml.min.js` | [js-yaml](https://github.com/nodeca/js-yaml) 4.1.0 (MIT), to write and read YAML |

GitHub Pages publishes `main` as it is; there is no build step.
