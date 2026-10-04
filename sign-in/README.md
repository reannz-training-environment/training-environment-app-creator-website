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

2. **Make the helper.** In Cloudflare: *Workers & Pages*, *Create*, *Create
   Worker*. Name it, say, `app-creator-sign-in`, and deploy the starter. Then
   *Edit code*, replace it all with [`worker.js`](worker.js), and deploy.

3. **Give it its settings.** The Worker's *Settings*, *Variables and Secrets*:

   | Name | Type | Value |
   | --- | --- | --- |
   | `SITE` | Text | `https://reannz-training-environment.github.io` |
   | `CLIENT_ID` | Text | the client ID from step 1 |
   | `CLIENT_SECRET` | Secret | the client secret from step 1 (on the clipboard) |

   Deploy again, and note the Worker's address, like
   `https://app-creator-sign-in.<your-subdomain>.workers.dev`.

4. **Point the website at it.** In [`assets/app.js`](../assets/app.js), set:

   ```js
   const SIGN_IN = window.APP_CREATOR_SIGN_IN || { clientId: "<client ID>", helper: "<Worker address>" };
   ```

   and push. The button then signs people in and files their requests.

If the client secret ever leaks, make a new one on the sign-in App's settings
page and delete the old one, then update `CLIENT_SECRET`.
