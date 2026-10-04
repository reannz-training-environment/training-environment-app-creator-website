# Sign-in helper

With this set up, the website's **Create pull request** button files the app
request itself: the requester signs in with GitHub once (one *Authorize*
click, the first time), and from then on there is nothing to press on GitHub.
Without it, the button opens GitHub's request form for them to press
*Create*.

The website does all of signing in except one step. GitHub hands back a code
that only becomes a token in exchange for the sign-in App's client secret,
and a web page cannot keep a secret. [`worker.js`](worker.js) does that one
exchange and nothing else. The token it returns lasts 8 hours, and can only
file and edit issues on the app creator repository, as the signed-in person.
Who may have their request built is still decided by the app creator: members
of the organisation and its outside collaborators.

## Setting it up

You need an owner of the organisation, and a [Cloudflare](https://dash.cloudflare.com/sign-up)
account. The Workers free plan is plenty.

1. **Make the sign-in App.** In a clone of the app creator, with the GitHub
   CLI signed in:

   ```bash
   python -m te_app_creator setup-app --sign-in
   ```

   Press *Create GitHub App* on GitHub. The command prints the App's client
   ID, and puts its client secret on the clipboard. Then, on the page that
   opens, install it on the organisation, choosing *Only select repositories*
   and `training-environment-app-creator`.

   The App is public: GitHub only lets members of the organisation sign in
   through a private App, and outside collaborators must be able to as well.
   It has no webhook, and may only write issues.

2. **Make the helper from this repository.** Cloudflare deploys it straight
   from GitHub, and again whenever it changes here.
   [`wrangler.jsonc`](wrangler.jsonc) holds its name and its two public
   settings: the website's address, and the sign-in App's client ID.

   In the [Cloudflare dashboard](https://dash.cloudflare.com):
   *Workers & Pages*, *Create application*, *Import a repository*. Choose
   GitHub, then `reannz-training-environment` and
   `training-environment-app-creator-website`. If the repository isn't
   listed, let Cloudflare's GitHub App see it.

   On the next page:

   | Setting | Value |
   | --- | --- |
   | Project name | `app-creator-sign-in` (it must match `name` in `wrangler.jsonc`) |
   | Build command | leave empty |
   | Deploy command | `npx wrangler deploy` |
   | Root directory, under *Advanced settings* | `sign-in` |

   Press *Create and deploy*, and wait for the deploy to finish.

3. **Give it the secret.** The Worker's *Settings*, *Variables and Secrets*,
   *Add*: type *Secret*, name `CLIENT_SECRET`, value the client secret from
   step 1 (it was put on the clipboard), then *Deploy*. Note the Worker's
   address, shown under *Domains & Routes*, like
   `https://app-creator-sign-in.<your-subdomain>.workers.dev`.

   Or, without connecting GitHub: *Create application*, *Start with Hello
   World*, name it `app-creator-sign-in`, deploy, *Edit code*, paste in
   [`worker.js`](worker.js), and deploy. Then add `SITE` and `CLIENT_ID`
   (both *Text*, with the values in `wrangler.jsonc`) as well as
   `CLIENT_SECRET`.

4. **Point the website at it.** In [`assets/app.js`](../assets/app.js), set:

   ```js
   const SIGN_IN = window.APP_CREATOR_SIGN_IN || { clientId: "<client ID>", helper: "<Worker address>" };
   ```

   and push. The button then signs people in and files their requests.

If the client secret ever leaks, make a new one on the sign-in App's settings
page and delete the old one, then update `CLIENT_SECRET`.
