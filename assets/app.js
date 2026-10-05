/*
 * Training environment app creator website.
 *
 * Builds an app spec (apps/<name>.yml) from the form, checks it with the same
 * rules as the app creator's schema, and files it as an app request: an issue
 * made with the app creator's "Request an app" form. Signed in with GitHub,
 * the page files it itself, as the requester; otherwise GitHub opens with the
 * form filled in, for them to press Create. The app creator turns the request
 * into the pull request.
 */
(() => {
  "use strict";

  const OWNER = "reannz-training-environment";
  const REPO = "training-environment-app-creator";
  const BRANCH = "main";
  const PREFIX = "training-environment";
  const CREATOR = `https://github.com/${OWNER}/${REPO}`;
  const SCHEMA_URL = `${CREATOR}/blob/${BRANCH}/schema/app.schema.json`;
  const API = "https://api.github.com";
  const KEYS = {
    draft: "app-creator:draft",
    auth: "app-creator:auth", // the signed-in person's token, for this tab only
    signIn: "app-creator:sign-in", // a sign-in under way: its state and PKCE verifier
    pending: "app-creator:pending", // the request to file once signed in
  };

  // Signing in with GitHub, so that the button files the request itself.
  // GitHub only finishes a sign-in for something holding the sign-in App's
  // client secret, which a web page cannot keep, so a small helper does that
  // one step (sign-in/README.md). Until both are set, the button opens
  // GitHub's request form instead, for the requester to press Create.
  const SIGN_IN = window.APP_CREATOR_SIGN_IN || {
    clientId: "Iv23liVpL0Lx5ZG7gWOV", // the sign-in App, reannz-app-creator-sign-in
    helper: "https://app-creator-sign-in.geoffrey-weal.workers.dev",
  };
  const CAN_SIGN_IN = Boolean(SIGN_IN.clientId && SIGN_IN.helper);
  // where GitHub sends people back to: the sign-in App's callback URL
  const HOME = `${location.origin}${location.pathname.replace(/index\.html$/, "")}`;
  const DEFAULTS = { rstudioImage: "rocker/rstudio", rVersion: "4.6.0", channels: "conda-forge, bioconda" };

  const INTERFACES = [
    { id: "jupyter", label: "JupyterLab" },
    { id: "rstudio", label: "RStudio" },
    { id: "codeserver", label: "VS Code" },
  ];

  const CARDS = [
    { id: "l4", label: "L4", memory: "24 GB" },
    { id: "a100_40", label: "A100", memory: "40 GB" },
    { id: "a100", label: "A100", memory: "80 GB" },
    { id: "h100", label: "H100 NVL", memory: "94 GB" },
    { id: "pro_6000", label: "RTX PRO 6000", memory: "96 GB" },
  ];

  const VRAM = [
    ["100MiB", "100 MiB"],
    ["200MiB", "200 MiB (default)"],
    ["512MiB", "512 MiB"],
    ["1GiB", "1 GiB"],
    ["2GiB", "2 GiB"],
    ["4GiB", "4 GiB"],
    ["full", "Full size (the real board)"],
  ];

  // The same patterns as schema/app.schema.json in the app creator
  const RE = {
    name: /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
    version: /^[0-9]+\.[0-9]+\.[0-9]+$/,
    python: /^3\.[0-9]+\.[0-9]+$/,
    user: /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/,
    workshopUrl: /^https?:\/\/[^\s"'`$\\]+$/,
    partition: /^[a-z][a-z0-9_-]{0,30}$/,
    node: /^[a-z][a-z0-9-]{0,30}$/,
    apt: /^[a-z0-9][a-z0-9+.-]*(=[A-Za-z0-9.+:~-]+)?$/,
    pip: /^(?:[A-Za-z0-9][^\n\r]{0,199}|git\+https:\/\/\S{1,200})$/,
    conda: /^(?:[A-Za-z0-9_.-]+::)?[A-Za-z0-9][A-Za-z0-9_.-]*(?: ?(?:==?|>=?|<=?|!=|~=) ?[A-Za-z0-9_.*+!]+(?:=[A-Za-z0-9_.*+]+)?(?: ?, ?(?:==?|>=?|<=?|!=|~=) ?[A-Za-z0-9_.*+!]+)*)?$/,
    channel: /^[A-Za-z0-9][A-Za-z0-9_.-]*$/,
    rPackage: /^[A-Za-z][A-Za-z0-9.]*$/,
    rGithub: /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._/-]+)?(?:@[A-Za-z0-9._/-]+)?$/,
    extension: /^[A-Za-z0-9][A-Za-z0-9-]*\.[A-Za-z0-9][A-Za-z0-9-]*(?:@[0-9][A-Za-z0-9.+-]*)?$/,
    repo: /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/,
    ref: /^[A-Za-z0-9._/-]{1,100}$/,
    relPath: /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/,
    dataUrl: /^https?:\/\/[A-Za-z0-9._~:/?#[\]@!&'()*+,;=%-]+$/,
    sha256: /^[a-f0-9]{64}$/,
    commit: /^[0-9a-f]{40}$/,
  };

  const ARCHIVES = [".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz", ".tar", ".zip"];

  // The package browser's lists, from assets/catalogue/<id>.json, which the
  // Catalogue workflow rebuilds every week (tools/build_catalogue.py). Each
  // fills one box of the Software section. `featured` packages come first in
  // lists that have no download counts to sort by.
  const LISTS = [
    {
      id: "bioconda",
      search: "bioinformatics tools",
      label: "Bioinformatics",
      target: "sw-conda",
      what: "bioinformatics tools from bioconda",
      featured: ["samtools", "bcftools", "bwa", "bowtie2", "minimap2", "fastqc", "multiqc", "fastp", "seqkit", "blast", "hisat2", "salmon", "star", "subread", "spades", "kraken2"],
    },
    { id: "workflows", search: "workflow managers", label: "Workflows", target: "sw-conda", what: "workflow managers, as conda packages" },
    { id: "pypi", search: "Python packages", label: "Python", target: "sw-pip", what: "of the most downloaded Python packages" },
    { id: "cran", search: "R packages", label: "R", target: "sw-cran", what: "R packages on CRAN", needs: "rstudio" },
    { id: "bioconductor", search: "Bioconductor packages", label: "Bioconductor", target: "sw-bioc", what: "Bioconductor packages", needs: "rstudio" },
    {
      id: "apt",
      search: "Ubuntu packages",
      label: "Command line",
      target: "sw-apt",
      what: "Ubuntu 22.04 packages",
      featured: ["parallel", "pigz", "tmux", "htop", "tree", "bc", "ncdu", "jq", "screen", "zsh", "emacs-nox", "build-essential", "gfortran", "cmake", "openmpi-bin", "libopenmpi-dev", "hdf5-tools", "netcdf-bin"],
    },
    { id: "vscode", search: "VS Code extensions", label: "VS Code", target: "sw-vscode", what: "VS Code extensions on Open VSX", needs: "codeserver" },
  ];
  const ROW = 34; // the height of a package browser row, in pixels

  // The Python and R versions Mahuika has, as NeSI's documentation lists
  // them. The Catalogue workflow keeps assets/catalogue/versions.json up to
  // date; these are used until it loads.
  let MAHUIKA = {
    python: { versions: ["3.14.4", "3.11.6", "3.11.3", "3.10.5", "3.9.9", "3.9.5", "3.8.2", "3.8.1", "3.7.3", "2.7.18", "2.7.16"], default: "3.14.4" },
    r: { versions: ["4.6.0", "4.3.2", "4.3.1", "4.2.1", "4.1.0", "4.0.1", "3.6.2", "3.6.1", "3.5.3"], default: "4.6.0" },
  };
  // the R 3 versions the app creator can make (its spec.R3_SNAPSHOTS)
  const R3 = ["3.4.2", "3.4.3", "3.4.4", "3.5.0", "3.5.1", "3.5.2", "3.5.3", "3.6.0", "3.6.1", "3.6.2", "3.6.3"];
  // the Ubuntu of each rocker R image, and that Ubuntu's own Python
  const UBUNTU_PYTHON = { focal: "3.8", jammy: "3.10", noble: "3.12" };
  const IMAGE_PYTHON = UBUNTU_PYTHON.jammy; // JupyterLab and VS Code: Ubuntu 22.04

  // ------------------------------------------------------------------ state

  let dataRows = [];
  let rowSeq = 0;
  let loaded = null; // {name, sha}: the existing app this form edits
  const repoState = new Map(); // owner/repo -> "exists" | "new" | "unknown" | "checking"
  const specState = new Map(); // app name -> "exists" | "new"
  let availabilityTimer = null;
  let draftTimer = null;
  let busy = false;
  const catalogues = new Map(); // list id -> the loaded list, or a promise of it
  let browsing = LISTS[0]; // the list the package browser shows
  let shown = []; // its rows that match the search
  let filtered = ""; // the list and search that `shown` is for
  let drawn = { rows: null, first: 0, last: 0 }; // the rows on screen
  let searchTimer = null;

  // ---------------------------------------------------------------- helpers

  const $ = (id) => document.getElementById(id);
  const val = (id) => $(id).value;
  const checked = (id) => $(id).checked;
  const num = (id) => {
    const n = Number.parseInt($(id).value, 10);
    return Number.isFinite(n) ? n : NaN;
  };

  function esc(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // one item per line; with words=true, also split on commas and spaces
  function items(text, words = false) {
    const parts = words ? text.split(/[\s,]+/) : text.split(/\r?\n/);
    return parts.map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
  }

  function unique(list) {
    return [...new Set(list)];
  }

  function trimSlashes(path) {
    return path.trim().replace(/^\/+|\/+$/g, "");
  }

  function badPathParts(path) {
    return path.split("/").some((p) => p === "." || p === ".." || p === ".git");
  }

  function repoName(iface, name) {
    return `${PREFIX}-${iface}-${name || "<name>"}-app`;
  }

  function storage(kind) {
    try {
      return kind === "local" ? window.localStorage : window.sessionStorage;
    } catch {
      return null;
    }
  }

  function store(key, value, kind = "local") {
    try {
      const s = storage(kind);
      if (!s) return;
      if (value === null) s.removeItem(key);
      else s.setItem(key, value);
    } catch {
      /* private window or blocked storage: carry on without it */
    }
  }

  function recall(key, kind = "local") {
    try {
      const s = storage(kind);
      return s ? s.getItem(key) : null;
    } catch {
      return null;
    }
  }

  function base64ToUtf8(b64) {
    const binary = atob(b64.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------- sign-in

  // the signed-in person, {token, login, expires}, while their token lasts
  function account() {
    try {
      const auth = JSON.parse(recall(KEYS.auth, "session") || "null");
      return auth && auth.expires > Date.now() + 60000 ? auth : null;
    } catch {
      return null;
    }
  }

  function getToken() {
    const auth = account();
    return auth ? auth.token : "";
  }

  function base64url(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function randomText(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return base64url(bytes);
  }

  // PKCE: GitHub only accepts the code back with the verifier behind this
  async function challengeFor(verifier) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64url(new Uint8Array(digest));
  }

  // off to GitHub to sign in; `pending` is the request to file on the way back
  async function signIn(pending) {
    const state = randomText(16);
    const verifier = randomText(48);
    store(KEYS.signIn, JSON.stringify({ state, verifier }), "session");
    store(KEYS.pending, pending ? JSON.stringify(pending) : null, "session");
    saveDraft();
    const params = new URLSearchParams({
      client_id: SIGN_IN.clientId,
      redirect_uri: HOME,
      state,
      code_challenge: await challengeFor(verifier),
      code_challenge_method: "S256",
    });
    location.assign(`https://github.com/login/oauth/authorize?${params}`);
  }

  function signOut() {
    store(KEYS.auth, null, "session");
    renderAccount();
    render();
  }

  // back from GitHub: swap its code for a token, then file the pending request
  async function finishSignIn() {
    const params = new URLSearchParams(location.search);
    if (!params.has("code") && !params.has("error")) return;
    // the code is single use; keep it out of the address bar and history
    history.replaceState(null, "", `${location.pathname}${location.hash}`);
    let saved = null;
    let pending = null;
    try {
      saved = JSON.parse(recall(KEYS.signIn, "session") || "null");
      pending = JSON.parse(recall(KEYS.pending, "session") || "null");
    } catch {
      /* treated as no sign-in under way */
    }
    store(KEYS.signIn, null, "session");
    store(KEYS.pending, null, "session");

    const fail = (why) => {
      showResult(`<p><strong>You are not signed in:</strong> ${esc(why)}</p>${formFallback(pending)}`, true);
      wireFormFallback(pending);
    };
    if (params.has("error")) {
      fail(params.get("error") === "access_denied" ? "GitHub was not given permission." : params.get("error_description") || params.get("error"));
      return;
    }
    if (!saved || saved.state !== params.get("state")) {
      fail("GitHub's answer did not match a sign-in started on this page. Try again.");
      return;
    }
    try {
      const res = await fetch(SIGN_IN.helper, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: params.get("code"), code_verifier: saved.verifier, redirect_uri: HOME }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || `the sign-in helper answered ${res.status}`);
      const user = await gh("/user", { token: data.access_token });
      const expires = Date.now() + (data.expires_in || 28800) * 1000;
      store(KEYS.auth, JSON.stringify({ token: data.access_token, login: user.login, avatar: user.avatar_url, expires }), "session");
    } catch (e) {
      fail(e.message);
      return;
    }
    renderAccount();
    render();
    if (pending) await fileRequest(pending, { justSignedIn: true });
  }

  // GitHub's mark (Octicons mark-github, MIT), for the sign-in button
  const GITHUB_MARK =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path></svg>';

  // top right: a sign-in button, or who is signed in
  function renderAccount() {
    const el = $("header-account");
    el.hidden = !CAN_SIGN_IN;
    if (!CAN_SIGN_IN) return;
    const auth = account();
    if (auth) {
      const avatar = auth.avatar ? `<img class="avatar" src="${esc(auth.avatar)}" alt="">` : "";
      el.innerHTML = `${avatar}<span>@${esc(auth.login)}</span><button type="button" class="link-button" id="sign-out">Sign out</button>`;
      $("sign-out").addEventListener("click", signOut);
    } else {
      el.innerHTML = `<button type="button" class="sign-in-button" id="sign-in">${GITHUB_MARK}Sign in with GitHub</button>`;
      $("sign-in").addEventListener("click", () => signIn(null));
    }
  }

  function authHeaders(token = getToken()) {
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function gh(path, { method = "GET", body, allow = [], token } = {}) {
    const headers = authHeaders(token);
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(API + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (allow.includes(res.status)) return null;
    if (!res.ok) {
      let message = "";
      try {
        message = (await res.json()).message || "";
      } catch {
        /* not JSON */
      }
      const err = new Error(`GitHub said ${res.status}${message ? `: ${message}` : ""}`);
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  // --------------------------------------------------------------- versions

  function olderThan(a, b) {
    const x = a.split(".").map(Number);
    const y = b.split(".").map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
    }
    return false;
  }

  // the Ubuntu of rocker's image of this R (R 3 is built on its R 4.0.1 one)
  function rUbuntu(r) {
    return olderThan(r, "4.2.2") ? "focal" : olderThan(r, "4.4.2") ? "jammy" : "noble";
  }

  // the Python versions on offer: Mahuika's Python 3, from 3.7, which
  // JupyterLab still runs on
  function offeredPython() {
    return MAHUIKA.python.versions.filter((v) => v.startsWith("3.") && !olderThan(v, "3.7.0"));
  }

  function offeredR() {
    return MAHUIKA.r.versions.filter((v) => !olderThan(v, "4.0.0") || R3.includes(v));
  }

  function renderVersionMenus() {
    const python = $("python-version");
    const r = $("r-version");
    const keep = [python.value, r.value];
    python.innerHTML =
      '<option value="">Ubuntu\'s own</option>' +
      offeredPython().map((v) => `<option value="${v}">${v}${v === MAHUIKA.python.default ? " (Mahuika's default)" : ""}</option>`).join("");
    r.innerHTML = offeredR().map((v) => `<option value="${v}">${v}${v === MAHUIKA.r.default ? " (Mahuika's default)" : ""}</option>`).join("");
    setVersion("python-version", keep[0]);
    setVersion("r-version", keep[1] || DEFAULTS.rVersion);
    const left = MAHUIKA.python.versions.filter((v) => !offeredPython().includes(v));
    $("python-left-out").textContent = left.length
      ? ` Mahuika's Python ${left.join(" and ")} ${left.length === 1 ? "is" : "are"} not offered: JupyterLab and pip no longer run on ${left.length === 1 ? "it" : "them"}.`
      : "";
  }

  // what Ubuntu's own Python is, and how R is made, for the versions chosen
  function renderVersionNotes(spec) {
    const rstudio = spec.interfaces.includes("rstudio");
    const others = spec.interfaces.some((i) => i !== "rstudio");
    const rv = (spec.advanced || {}).r_version || DEFAULTS.rVersion;
    const rstudioPython = UBUNTU_PYTHON[rUbuntu(rv)];
    const own = [others && IMAGE_PYTHON, rstudio && (others ? `${rstudioPython} in RStudio` : rstudioPython)].filter(Boolean);
    $("python-version").options[0].textContent = `Ubuntu's own: ${own.join(", ") || IMAGE_PYTHON}`;
    $("r-hint").textContent = olderThan(rv, "4.0.0")
      ? `R ${rv} comes from Posit's builds of R, on rocker's R 4.0.1 image. Its packages are compiled from CRAN as it was in R ${rv}'s time, so the image takes longer to build.`
      : `From the rocker/${val("rstudio-image").split("/")[1] || "rstudio"}:${rv} image, on Ubuntu ${{ focal: "20.04", jammy: "22.04", noble: "24.04" }[rUbuntu(rv)]}.`;
  }

  async function loadVersions() {
    try {
      const res = await fetch("assets/catalogue/versions.json");
      if (!res.ok) return;
      const data = await res.json();
      if (data.python && data.python.versions && data.r && data.r.versions) {
        MAHUIKA = data;
        renderVersionMenus();
        render();
      }
    } catch {
      /* the built-in versions stand */
    }
  }

  // ------------------------------------------------------------------- spec

  function selectedInterfaces() {
    return INTERFACES.map((i) => i.id).filter((id) => document.querySelector(`input[name="interface"][value="${id}"]`).checked);
  }

  function selectedCards() {
    return CARDS.map((c) => c.id).filter((id) => $(`card-${id}`).checked);
  }

  function gpuMode() {
    const picked = document.querySelector('input[name="gpu-mode"]:checked');
    return picked ? picked.value : "all";
  }

  function dataItem(row) {
    if (row.type === "github") {
      const item = { type: "github", repo: row.repo.trim() };
      if (row.ref.trim()) item.ref = row.ref.trim();
      if (trimSlashes(row.path)) item.path = trimSlashes(row.path);
      if (trimSlashes(row.dest)) item.dest = trimSlashes(row.dest);
      return item;
    }
    const item = { type: "url", url: row.url.trim() };
    if (row.extract !== "auto") item.extract = row.extract === "yes";
    if (row.sha256.trim()) item.sha256 = row.sha256.trim().toLowerCase();
    if (trimSlashes(row.dest)) item.dest = trimSlashes(row.dest);
    return item;
  }

  function readSpec() {
    const spec = { schema_version: 1, name: val("name").trim(), title: val("title").trim() };
    const description = val("description").trim();
    if (description) spec.description = description;
    spec.version = val("version").trim() || "0.1.0";
    if (val("visibility") !== "public") spec.visibility = val("visibility");
    const maintainers = unique(items(val("maintainers"), true).map((m) => m.replace(/^@/, "")));
    if (maintainers.length) spec.maintainers = maintainers;
    const workshop = val("workshop-url").trim();
    if (workshop) spec.workshop_url = workshop;

    const interfaces = selectedInterfaces();
    spec.interfaces = interfaces;

    spec.resources = {
      cpu: num("cpu"),
      memory_gb: num("memory"),
      wall_time_hours: { default: num("wall-default"), min: num("wall-min"), max: num("wall-max") },
    };

    const features = {};
    const gpu = checked("gpu-enabled");
    if (gpu) {
      features.gpu = {
        enabled: true,
        mode: gpuMode(),
        cards: selectedCards(),
        vram: val("gpu-vram"),
        pytorch: checked("gpu-pytorch"),
        numba: checked("gpu-numba"),
        session_form: checked("gpu-form"),
      };
    }
    if (gpu || checked("slurm-enabled")) {
      features.slurm = { enabled: true };
      if (!gpu) {
        features.slurm.partition = val("slurm-partition").trim();
        features.slurm.node_name = val("slurm-node").trim();
      }
    }
    if (checked("lmod-enabled")) features.lmod = { enabled: true };
    if (Object.keys(features).length) spec.features = features;

    const software = {};
    const conda = unique(items(val("sw-conda")));
    if (conda.length) {
      software.conda = { channels: unique(items(val("sw-channels"), true)), packages: conda };
    }
    const pip = unique(items(val("sw-pip")));
    if (pip.length) software.pip = pip;
    const apt = unique(items(val("sw-apt"), true));
    if (apt.length) software.apt = apt;
    const r = {};
    const cran = unique(items(val("sw-cran"), true));
    const bioc = unique(items(val("sw-bioc"), true));
    const rGithub = unique(items(val("sw-rgithub"), true));
    if (cran.length) r.cran = cran;
    if (bioc.length) r.bioconductor = bioc;
    if (rGithub.length) r.github = rGithub;
    if (Object.keys(r).length) software.r = r;
    const extensions = unique(items(val("sw-vscode"), true));
    if (extensions.length) software.vscode_extensions = extensions;
    if (Object.keys(software).length) spec.software = software;

    const data = dataRows.map(dataItem);
    if (data.length) spec.data = data;

    const advanced = {};
    const startDir = trimSlashes(val("start-dir"));
    if (startDir && interfaces.includes("codeserver")) advanced.start_dir = startDir;
    if (val("python-version")) advanced.python_version = val("python-version");
    if (interfaces.includes("rstudio")) {
      advanced.rstudio_image = val("rstudio-image");
      advanced.r_version = val("r-version");
    }
    const dockerfile = val("dockerfile").trim();
    if (dockerfile) advanced.dockerfile = dockerfile;
    const startup = val("startup").trim();
    if (startup) advanced.startup = startup;
    if (Object.keys(advanced).length) spec.advanced = advanced;
    return spec;
  }

  function condaName(spec) {
    return spec.split("::").pop().split(/[ =<>!~]/)[0].trim().toLowerCase();
  }

  function validate(spec) {
    const errors = [];
    const warnings = [];
    const err = (message, field) => errors.push({ message, field });

    if (!spec.name) err("Give the app a name.", "name");
    else if (spec.name.length < 2 || spec.name.length > 40) err("The name must be 2 to 40 characters.", "name");
    else if (!RE.name.test(spec.name)) {
      err(
        /_/.test(spec.name)
          ? "Use hyphens, not underscores, in the name: GitHub packages do not allow underscores."
          : "The name may only have lower case letters, digits and single hyphens, and must start with a letter.",
        "name",
      );
    }
    if (!spec.title) err("Give the app a title.", "title");
    if (!RE.version.test(spec.version)) err("The version must look like 1.2.3.", "version");
    for (const m of spec.maintainers || []) if (!RE.user.test(m)) err(`"${m}" is not a GitHub username.`, "maintainers");
    if (spec.workshop_url && !RE.workshopUrl.test(spec.workshop_url)) err("The workshop material link must be an http(s) URL.", "workshop-url");
    if (!spec.interfaces.length) err("Choose at least one interface.");

    const r = spec.resources;
    if (!(r.cpu >= 1 && r.cpu <= 32)) err("CPUs must be between 1 and 32.", "cpu");
    if (!(r.memory_gb >= 1 && r.memory_gb <= 256)) err("Memory must be between 1 and 256 GB.", "memory");
    const w = r.wall_time_hours;
    if ([w.default, w.min, w.max].some((h) => !(h >= 1 && h <= 168))) err("Hours must be between 1 and 168.", "wall-default");
    else if (w.min > w.max) err("The shortest session is longer than the longest.", "wall-min");
    else if (w.default < w.min || w.default > w.max) err("The default hours must be between the shortest and longest.", "wall-default");

    const f = spec.features || {};
    if (f.gpu) {
      if (!f.gpu.cards.length) err(f.gpu.mode === "choose" ? "Choose at least one GPU card to offer." : "Choose at least one GPU card.");
      if (f.gpu.mode === "choose" && f.gpu.cards.length === 1) {
        warnings.push("With one card there is nothing to choose: the launch form's GPU menu will have one entry.");
      }
      if (r.cpu < 4) warnings.push("With fewer than 4 CPUs, every small job pins the emulated GPU's utilisation at 100%.");
    }
    if (f.slurm && !f.gpu) {
      if (!RE.partition.test(f.slurm.partition || "")) err("The Slurm partition must be lower case letters, digits, - or _.", "slurm-partition");
      if (!RE.node.test(f.slurm.node_name || "")) err("The Slurm node name must be lower case letters, digits or -.", "slurm-node");
    }

    const sw = spec.software || {};
    const check = (list, re, what) => {
      for (const item of list || []) if (!re.test(item)) err(`"${item}" is not a valid ${what}.`);
    };
    if (sw.conda) {
      check(sw.conda.packages, RE.conda, "conda package (name, or name=version)");
      check(sw.conda.channels, RE.channel, "conda channel");
      const names = sw.conda.packages.map(condaName);
      const twice = unique(names.filter((n, i) => names.indexOf(n) !== i));
      if (twice.length) err(`Conda package ${twice.join(", ")} is listed more than once.`);
      if (!sw.conda.channels.length) err("Give at least one conda channel.", "sw-channels");
    }
    check(sw.pip, RE.pip, "pip requirement");
    check(sw.apt, RE.apt, "apt package");
    if (sw.r) {
      check(sw.r.cran, RE.rPackage, "R package name");
      check(sw.r.bioconductor, RE.rPackage, "Bioconductor package name");
      check(sw.r.github, RE.rGithub, "GitHub R package (owner/repo)");
      if (!spec.interfaces.includes("rstudio")) warnings.push("R packages are only installed in the RStudio app, and RStudio is not chosen.");
    }
    if (sw.vscode_extensions) {
      check(sw.vscode_extensions, RE.extension, "VS Code extension id (publisher.name)");
      if (!spec.interfaces.includes("codeserver")) warnings.push("VS Code extensions are only installed in the VS Code app, and VS Code is not chosen.");
    }
    if (f.lmod && !(sw.conda && sw.conda.packages.length)) {
      warnings.push("Lmod is on, but there are no conda packages to make modules of.");
    }

    (spec.data || []).forEach((item, i) => {
      const n = `Data ${i + 1}`;
      if (item.type === "github") {
        if (!RE.repo.test(item.repo)) err(`${n}: give the repository as owner/name.`);
        if (item.ref !== undefined && !RE.ref.test(item.ref)) err(`${n}: the branch, tag or commit has characters that are not allowed.`);
        if (item.ref === undefined || !RE.commit.test(item.ref)) {
          warnings.push(`${n} (${item.repo || "repository"}) is not pinned to a commit, so a rebuild may pick up different files. "Pin" fixes that.`);
        }
        if (item.path !== undefined && (!RE.relPath.test(item.path) || badPathParts(item.path))) err(`${n}: the folder is not a valid path.`);
      } else {
        if (!RE.dataUrl.test(item.url)) err(`${n}: give an http(s) URL without spaces or quotes.`);
        else if (!fileName(item.url)) err(`${n}: the URL must end in a file name.`);
        if (item.sha256 !== undefined && !RE.sha256.test(item.sha256)) err(`${n}: the SHA-256 must be 64 hexadecimal characters.`);
      }
      if (item.dest !== undefined && (!RE.relPath.test(item.dest) || badPathParts(item.dest))) err(`${n}: the destination is not a valid folder name.`);
    });

    const adv = spec.advanced || {};
    if (adv.start_dir && (!RE.relPath.test(adv.start_dir) || badPathParts(adv.start_dir))) err("The folder VS Code opens is not a valid path.", "start-dir");
    const emulators = Boolean(f.slurm); // the GPU emulator always brings Slurm
    if (adv.r_version !== undefined && !RE.version.test(adv.r_version)) err("The R version must look like 4.6.0.", "r-version");
    if (adv.python_version && !RE.python.test(adv.python_version)) err("The Python version must look like 3.11.6.", "python-version");
    else if (adv.python_version && olderThan(adv.python_version, "3.7.0")) {
      err(`Python ${adv.python_version} is too old: JupyterLab and pip need Python 3.7 or newer.`, "python-version");
    } else if (adv.python_version && emulators && olderThan(adv.python_version, "3.10.0")) {
      err(`The Slurm and GPU emulators need Python 3.10 or newer, not ${adv.python_version}.`, "python-version");
    }
    if (spec.interfaces.includes("rstudio") && RE.version.test(adv.r_version || "")) {
      const rv = adv.r_version;
      if (olderThan(rv, "4.0.0") && !R3.includes(rv)) err(`The app creator cannot make R ${rv}: of R 3, it can make ${R3.join(", ")}.`, "r-version");
      if (olderThan(rv, "4.0.0") && adv.rstudio_image !== "rocker/rstudio") {
        err(`${adv.rstudio_image} comes with packages built for R 4, so it cannot have R ${rv}: choose rocker/rstudio, and list the R packages the app needs.`, "rstudio-image");
      }
      if (emulators && !adv.python_version && rUbuntu(rv) === "focal") {
        err(`With R ${rv}, the RStudio image is Ubuntu 20.04, whose Python 3.8 is too old for the Slurm and GPU emulators: choose Python 3.10 or newer.`, "python-version");
      }
    }
    if (adv.dockerfile) warnings.push("Reviewers will read the extra Dockerfile instructions before merging.");
    if (adv.startup) warnings.push("Reviewers will read the session start commands before merging.");

    if (spec.name && RE.name.test(spec.name) && specState.get(spec.name) === "exists" && !(loaded && loaded.name === spec.name)) {
      warnings.push(`An app called ${spec.name} already exists. To change it, use "Edit an existing app"; this request would replace it.`);
    }
    return { errors, warnings };
  }

  function fileName(url) {
    try {
      return new URL(url).pathname.split("/").pop();
    } catch {
      return "";
    }
  }

  function defaultDest(row) {
    if (row.type === "github") {
      const repo = row.repo.trim();
      return RE.repo.test(repo) ? repo.split("/")[1] : "";
    }
    const name = fileName(row.url.trim());
    if (!name) return "";
    const lower = name.toLowerCase();
    const suffix = ARCHIVES.find((s) => lower.endsWith(s));
    const stem = suffix ? name.slice(0, -suffix.length) : name.replace(/\.[^.]*$/, "");
    return stem.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "") || "data";
  }

  function toYaml(spec) {
    const repos = spec.interfaces.map((i) => repoName(i, spec.name));
    const header = [
      "# A REANNZ training environment app, from the app creator website.",
      "# Merging it creates, or updates, one repository per interface:",
      ...repos.map((r) => `#   ${r}`),
      `# Every field is described in ${SCHEMA_URL}`,
      "",
    ];
    // eslint-disable-next-line no-undef
    return header.join("\n") + jsyaml.dump(spec, { lineWidth: -1, noRefs: true, quotingType: '"' });
  }

  // ------------------------------------------------------------- data rows

  function addRow(type, values = {}) {
    dataRows.push({
      id: ++rowSeq,
      type,
      repo: "",
      ref: "",
      path: "",
      url: "",
      extract: "auto",
      sha256: "",
      dest: "",
      ...values,
    });
  }

  function renderRows() {
    const container = $("data-rows");
    container.innerHTML = dataRows
      .map((row, i) => {
        const dest = `
          <div class="field">
            <label for="dest-${row.id}">Copy to</label>
            <div class="inline-action"><span class="prefix" aria-hidden="true">~/</span>
              <input id="dest-${row.id}" data-row="${row.id}" data-key="dest" value="${esc(row.dest)}" placeholder="${esc(defaultDest(row) || "folder")}" spellcheck="false">
            </div>
          </div>`;
        if (row.type === "github") {
          return `
          <div class="data-row" data-id="${row.id}">
            <div class="data-row-head"><strong>${i + 1}. GitHub repository</strong>
              <button type="button" class="button ghost small" data-remove="${row.id}" aria-label="Remove data source ${i + 1}">Remove</button></div>
            <div class="grid">
              <div class="field span-2">
                <label for="repo-${row.id}">Repository</label>
                <input id="repo-${row.id}" data-row="${row.id}" data-key="repo" value="${esc(row.repo)}" placeholder="owner/name, or paste a GitHub link" spellcheck="false">
              </div>
              <div class="field">
                <label for="ref-${row.id}">Branch, tag or commit</label>
                <div class="inline-action">
                  <input id="ref-${row.id}" data-row="${row.id}" data-key="ref" value="${esc(row.ref)}" placeholder="default branch" spellcheck="false">
                  <button type="button" class="button secondary small" data-pin="${row.id}" title="Replace with the commit it points to now">Pin</button>
                </div>
                <p class="hint" id="pin-note-${row.id}">${esc(row.pinNote || "")}</p>
              </div>
              <div class="field">
                <label for="path-${row.id}">Folder <span class="optional">optional</span></label>
                <input id="path-${row.id}" data-row="${row.id}" data-key="path" value="${esc(row.path)}" placeholder="the whole repository" spellcheck="false">
              </div>
              ${dest}
            </div>
          </div>`;
        }
        return `
          <div class="data-row" data-id="${row.id}">
            <div class="data-row-head"><strong>${i + 1}. Download</strong>
              <button type="button" class="button ghost small" data-remove="${row.id}" aria-label="Remove data source ${i + 1}">Remove</button></div>
            <div class="grid">
              <div class="field span-2">
                <label for="url-${row.id}">URL</label>
                <input id="url-${row.id}" data-row="${row.id}" data-key="url" value="${esc(row.url)}" placeholder="https://.../data.zip" spellcheck="false">
              </div>
              <div class="field">
                <label for="extract-${row.id}">Unpack</label>
                <select id="extract-${row.id}" data-row="${row.id}" data-key="extract">
                  <option value="auto"${row.extract === "auto" ? " selected" : ""}>If it is a zip or tar archive</option>
                  <option value="yes"${row.extract === "yes" ? " selected" : ""}>Yes</option>
                  <option value="no"${row.extract === "no" ? " selected" : ""}>No, copy the file as it is</option>
                </select>
              </div>
              <div class="field">
                <label for="sha-${row.id}">SHA-256 <span class="optional">optional</span></label>
                <input id="sha-${row.id}" data-row="${row.id}" data-key="sha256" value="${esc(row.sha256)}" placeholder="checks the download" spellcheck="false">
              </div>
              ${dest}
            </div>
          </div>`;
      })
      .join("");
    $("data-empty").hidden = dataRows.length > 0;
  }

  function rowById(id) {
    return dataRows.find((r) => r.id === Number(id));
  }

  // "https://github.com/o/r/tree/main/data" -> {repo: "o/r", ref: "main", path: "data"}
  function parseGithub(input) {
    const text = input.trim();
    let m = text.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/\s#?]+)(?:\/([^\s#?]*))?)?\/?(?:[#?].*)?$/);
    if (m) return { repo: `${m[1]}/${m[2]}`, ref: m[3] || "", path: trimSlashes(m[4] || "") };
    m = text.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
    if (m) return { repo: `${m[1]}/${m[2]}`, ref: "", path: "" };
    return null;
  }

  async function pinRow(row) {
    const note = $(`pin-note-${row.id}`);
    if (!RE.repo.test(row.repo.trim())) {
      note.textContent = "Give the repository as owner/name first.";
      return;
    }
    note.textContent = "Looking up the commit...";
    const repo = row.repo.trim();
    const ref = row.ref.trim();
    try {
      let sha;
      if (ref) {
        sha = (await gh(`/repos/${repo}/commits/${encodeURIComponent(ref)}`)).sha;
      } else {
        const info = await gh(`/repos/${repo}`);
        sha = (await gh(`/repos/${repo}/commits/${encodeURIComponent(info.default_branch)}`)).sha;
        row.pinNote = `Was the head of ${info.default_branch}.`;
      }
      if (ref && !RE.commit.test(ref)) row.pinNote = `Was ${ref}.`;
      row.ref = sha;
      $(`ref-${row.id}`).value = sha;
      note.textContent = row.pinNote || "Already a commit.";
      render();
    } catch (e) {
      note.textContent =
        e.status === 404 || e.status === 422
          ? "Not found. The repository must be public, and the ref must exist."
          : e.status === 403
            ? "GitHub's rate limit for this page was reached; try again later, or sign in."
            : `Could not look it up: ${e.message}`;
    }
  }

  // -------------------------------------------------------- package browser
  //
  // One list at a time, with a search box. Lists run to tens of thousands of
  // packages, so only the rows in view are drawn. A row adds its package to
  // its list's box in the Software section, or takes it out again.

  // the name a line of a box is about: "numpy>=1.2" and "bioconda::samtools=1.2"
  // name numpy and samtools; pip treats -, _ and . alike
  function packageKey(target, line) {
    const name = line.split("::").pop().split(/[\s=<>!~@[;,]/)[0].trim().toLowerCase();
    return target === "sw-pip" ? name.replace(/[-_.]+/g, "-") : name;
  }

  function boxLines(target) {
    return items($(target).value, target !== "sw-conda" && target !== "sw-pip");
  }

  function chosenIn(target) {
    return new Set(boxLines(target).map((line) => packageKey(target, line)));
  }

  function loadList(list) {
    if (!catalogues.has(list.id)) {
      const loading = fetch(`assets/catalogue/${list.id}.json`)
        .then((res) => {
          if (!res.ok) throw new Error(`it answered ${res.status}`);
          return res.json();
        })
        .then((data) => {
          const featured = list.featured || [];
          const rows = data.items.map(([name, version, summary, popularity]) => ({
            name,
            version,
            summary,
            popularity,
            key: packageKey(list.target, name),
            lower: name.toLowerCase(),
            text: (summary || "").toLowerCase(),
          }));
          const first = featured.map((name) => rows.find((r) => r.name === name)).filter(Boolean);
          const loaded = { ...data, rows: [...first, ...rows.filter((r) => !first.includes(r))] };
          catalogues.set(list.id, loaded);
          return loaded;
        })
        .catch((e) => {
          catalogues.delete(list.id);
          throw e;
        });
      catalogues.set(list.id, loading);
    }
    return Promise.resolve(catalogues.get(list.id));
  }

  function renderBrowserTabs() {
    $("browse-tabs").innerHTML = LISTS.map(
      (list) =>
        `<button type="button" role="tab" class="browse-tab" id="browse-tab-${list.id}" data-list="${list.id}" aria-selected="${list === browsing}" aria-controls="browse-panel" tabindex="${list === browsing ? 0 : -1}">${esc(list.label)}</button>`,
    ).join("");
  }

  async function openList(list) {
    browsing = list;
    renderBrowserTabs();
    $("browse-panel").setAttribute("aria-labelledby", `browse-tab-${list.id}`);
    $("browse-search").placeholder = `Search ${list.search}`;
    $("browse-note").textContent = "";
    if (!(catalogues.get(list.id) && catalogues.get(list.id).rows)) {
      shown = [];
      drawRows();
      $("browse-count").textContent = "Loading the list...";
    }
    try {
      const data = await loadList(list);
      if (browsing !== list) return;
      const when = data.updated ? ` Updated ${data.updated} from ${new URL(data.source).hostname}.` : "";
      $("browse-note").textContent =
        `${data.title}${data.popularity ? `, most ${data.popularity.startsWith("installs") ? "installed" : "downloaded"} first` : ""}.${when} ` +
        `Click a package to add it to ${$(list.target).labels[0].textContent.trim()}, and again to take it out; anything else can be typed there.`;
      filterList();
    } catch (e) {
      if (browsing !== list) return;
      $("browse-count").textContent = `Could not load the list (${e.message}). Packages can still be typed in the boxes below.`;
    }
  }

  // the open list's rows that match the search: names that start with it,
  // then names that have it, then descriptions that have it
  function filterList() {
    const data = catalogues.get(browsing.id);
    if (!data || !data.rows) return;
    const query = $("browse-search").value.trim().toLowerCase();
    if (!query) {
      shown = data.rows;
    } else {
      const starts = [];
      const has = [];
      const about = [];
      for (const row of data.rows) {
        if (row.lower.startsWith(query)) starts.push(row);
        else if (row.lower.includes(query)) has.push(row);
        else if (row.text.includes(query)) about.push(row);
      }
      shown = [...starts, ...has, ...about];
    }
    countRows();
    // back to the top for a new list or search, not for the same one again
    if (filtered !== `${browsing.id}\n${query}`) $("browse-list").scrollTop = 0;
    filtered = `${browsing.id}\n${query}`;
    drawRows();
  }

  // "12 of 7,616 bioinformatics tools from bioconda", and whether the list's
  // interface is chosen
  function countRows() {
    const data = catalogues.get(browsing.id);
    if (!data || !data.rows) return;
    const total = data.rows.length.toLocaleString();
    const needs = browsing.needs && !selectedInterfaces().includes(browsing.needs);
    $("browse-count").textContent =
      (shown.length === data.rows.length ? `${total} ${browsing.what}` : `${shown.length.toLocaleString()} of ${total} ${browsing.what}`) +
      (needs ? ` (for the ${browsing.needs === "rstudio" ? "RStudio" : "VS Code"} app, which is not chosen)` : "");
  }

  function compactCount(n) {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
    return String(n);
  }

  // draw the rows in view, and a few either side. When those are the rows
  // already drawn, only their ticks are brought up to date: replacing a row
  // between a mouse press and its release would lose the click.
  function drawRows() {
    const list = $("browse-list");
    $("browse-spacer").style.height = `${shown.length * ROW}px`;
    const first = Math.max(0, Math.floor(list.scrollTop / ROW) - 6);
    const last = Math.min(shown.length, Math.ceil((list.scrollTop + (list.clientHeight || 300)) / ROW) + 6);
    const chosen = chosenIn(browsing.target);
    if (drawn.rows === shown && drawn.first === first && drawn.last === last) {
      for (const el of $("browse-rows").children) {
        el.setAttribute("aria-pressed", String(chosen.has(shown[Number(el.dataset.i)].key)));
      }
      return;
    }
    drawn = { rows: shown, first, last };
    const data = catalogues.get(browsing.id);
    const counted = data && data.popularity ? data.popularity : "";
    let html = "";
    for (let i = first; i < last; i++) {
      const row = shown[i];
      const on = chosen.has(row.key);
      html +=
        `<button type="button" class="browse-row" data-i="${i}" aria-pressed="${on}" style="top:${i * ROW}px"${row.summary ? ` title="${esc(row.summary)}"` : ""}>` +
        `<span class="browse-name">${esc(row.name)}</span>` +
        (row.version ? `<span class="browse-version">${esc(row.version)}</span>` : "") +
        `<span class="browse-summary">${esc(row.summary || "")}</span>` +
        (row.popularity ? `<span class="browse-pop" title="${esc(`${row.popularity.toLocaleString()} ${counted}`)}">${compactCount(row.popularity)}</span>` : "") +
        "</button>";
    }
    // drawing replaces the rows, so a row that had the focus gets it back
    const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest(".browse-row");
    $("browse-rows").innerHTML = html;
    if (focused) {
      const again = $("browse-rows").querySelector(`[data-i="${focused.dataset.i}"]`);
      if (again) again.focus({ preventScroll: true });
    }
  }

  // up and down move through the list, scrolling it as they go
  function stepRow(from, step) {
    const to = Math.max(0, Math.min(shown.length - 1, from + step));
    const list = $("browse-list");
    if (to * ROW < list.scrollTop) list.scrollTop = to * ROW;
    else if ((to + 1) * ROW > list.scrollTop + list.clientHeight) list.scrollTop = (to + 1) * ROW - list.clientHeight;
    drawRows();
    const row = $("browse-rows").querySelector(`[data-i="${to}"]`);
    if (row) row.focus({ preventScroll: true });
  }

  function togglePackage(list, name) {
    const area = $(list.target);
    const key = packageKey(list.target, name);
    const lines = area.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const idx = lines.findIndex((l) => packageKey(list.target, l) === key);
    if (idx >= 0) lines.splice(idx, 1);
    else lines.push(name);
    area.value = lines.join("\n");
    render();
  }

  // ------------------------------------------------------------- rendering

  function setInvalid(id, message) {
    const el = $(id);
    if (!el) return;
    if (message) el.setAttribute("aria-invalid", "true");
    else el.removeAttribute("aria-invalid");
  }

  function render() {
    const spec = readSpec();
    const { errors, warnings } = validate(spec);
    const name = RE.name.test(spec.name) ? spec.name : "";

    // interfaces and features
    for (const { id } of INTERFACES) {
      document.querySelector(`[data-repo-for="${id}"]`).textContent = repoName(id, name || spec.name || "<name>");
    }
    for (const el of document.querySelectorAll("[data-needs]")) {
      el.classList.toggle("not-applicable", !spec.interfaces.includes(el.dataset.needs));
    }
    const gpu = checked("gpu-enabled");
    $("gpu-options").hidden = !gpu;
    const choose = gpuMode() === "choose";
    $("gpu-cards-legend").textContent = choose ? "Cards learners can choose from" : "Cards on each session's node";
    $("gpu-vram-label").textContent = choose ? "GPU memory" : "Memory per card";
    $("gpu-form-label").textContent = choose
      ? "Learners can change the GPU's memory on the launch form"
      : "Learners can change each card's memory on the launch form";
    $("slurm-enabled").disabled = gpu;
    if (gpu) $("slurm-enabled").checked = true;
    $("slurm-locked").hidden = !gpu;
    $("slurm-options").hidden = gpu || !checked("slurm-enabled");

    // field errors; an empty name or title is not an error worth shouting
    // about until there is something to fix
    const blank = (e) => (e.field === "name" && !spec.name) || (e.field === "title" && !spec.title);
    const fieldErrors = new Map();
    for (const e of errors) if (e.field && !blank(e) && !fieldErrors.has(e.field)) fieldErrors.set(e.field, e.message);
    for (const id of ["name", "title", "version", "maintainers", "workshop-url", "cpu", "memory", "wall-default", "wall-min", "slurm-partition", "slurm-node", "start-dir", "python-version", "rstudio-image", "r-version", "sw-channels"]) {
      setInvalid(id, fieldErrors.get(id));
    }
    $("name-error").textContent = fieldErrors.get("name") || "";

    // the panel
    $("spec-path").textContent = `apps/${name || "<name>"}.yml`;
    const list = $("repo-list");
    if (!spec.interfaces.length) {
      list.innerHTML = '<li><span class="repo-state">No interface chosen</span></li>';
    } else {
      list.innerHTML = spec.interfaces
        .map((id) => {
          const repo = repoName(id, name);
          const state = name ? repoState.get(`${OWNER}/${repo}`) : undefined;
          const label = INTERFACES.find((i) => i.id === id).label;
          const text =
            state === "exists"
              ? "exists: approving updates it"
              : state === "new"
                ? "new repository"
                : state === "checking"
                  ? "checking..."
                  : "";
          return `<li><span class="repo-name">${esc(repo)}</span><span class="repo-state${state === "exists" ? " exists" : ""}">${esc(label)}${text ? ` · ${esc(text)}` : ""}</span></li>`;
        })
        .join("");
    }

    const shownErrors = errors.filter((e) => !blank(e));
    $("messages").innerHTML = [
      ...shownErrors.map((e) => `<div class="message error">${esc(e.message)}</div>`),
      ...warnings.map((w) => `<div class="message warning">${esc(w)}</div>`),
    ].join("");

    const button = $("create-pr");
    button.disabled = busy || errors.length > 0;
    const auth = CAN_SIGN_IN && account();
    const editing = loaded && loaded.name === spec.name;
    button.textContent = busy ? "Working..." : editing ? "Create pull request to update the app" : "Create pull request";
    const missing = [!spec.name && "a name", !spec.title && "a title"].filter(Boolean);
    $("pr-mode").textContent = errors.length
      ? shownErrors.length
        ? "Fix the problems above first."
        : `Give the app ${missing.join(" and ")} to start.`
      : auth
        ? `Files the request on GitHub as @${auth.login}. The app creator does the rest.`
        : CAN_SIGN_IN
          ? "Signs you in with GitHub, then files the request. The first time, GitHub asks you to authorise the app creator."
          : "Opens GitHub with the request filled in: press Create there, and the app creator does the rest.";

    renderVersionNotes(spec);
    $("yaml-preview").textContent = toYaml(spec);
    if ($("browse").open) {
      countRows();
      drawRows();
    }

    // folders VS Code could open
    const dests = unique(
      dataRows.map((r) => trimSlashes(r.dest) || defaultDest(r)).filter(Boolean).map((d) => d.split("/")[0]),
    );
    $("start-dirs").innerHTML = dests.map((d) => `<option value="${esc(d)}">`).join("");
    for (const row of dataRows) {
      const input = $(`dest-${row.id}`);
      if (input) input.placeholder = defaultDest(row) || "folder";
    }

    scheduleAvailability(name, spec.interfaces);
    scheduleDraft(spec);
  }

  function scheduleAvailability(name, interfaces) {
    clearTimeout(availabilityTimer);
    if (!name) return;
    availabilityTimer = setTimeout(async () => {
      let changed = false;
      for (const id of interfaces) {
        const full = `${OWNER}/${repoName(id, name)}`;
        if (repoState.has(full)) continue;
        repoState.set(full, "checking");
        try {
          const res = await fetch(`${API}/repos/${full}`, { headers: authHeaders() });
          repoState.set(full, res.status === 200 ? "exists" : res.status === 404 ? "new" : "unknown");
        } catch {
          repoState.set(full, "unknown");
        }
        changed = true;
      }
      if (!specState.has(name)) {
        try {
          const found = await gh(`/repos/${OWNER}/${REPO}/contents/apps/${name}.yml?ref=${BRANCH}`, { allow: [404] });
          specState.set(name, found ? "exists" : "new");
          changed = true;
        } catch {
          /* leave it unknown */
        }
      }
      if (changed) render();
    }, 700);
  }

  function scheduleDraft(spec) {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => saveDraft(spec), 400);
  }

  function saveDraft(spec = readSpec()) {
    clearTimeout(draftTimer);
    store(KEYS.draft, JSON.stringify({ spec, rows: dataRows, loaded }));
  }

  // ---------------------------------------------------------------- filling

  const KNOWN_KEYS = ["schema_version", "name", "title", "description", "version", "visibility", "maintainers", "workshop_url", "interfaces", "resources", "features", "software", "data", "advanced"];

  function setVal(id, value) {
    $(id).value = value === undefined || value === null ? "" : String(value);
  }

  // a version menu set to `value`, which gets its own entry if Mahuika does
  // not have it (an app made before, or by hand)
  function setVersion(id, value) {
    const select = $(id);
    if (value && ![...select.options].some((o) => o.value === value)) {
      select.insertAdjacentHTML("beforeend", `<option value="${esc(value)}" data-extra>${esc(value)} (not a Mahuika version)</option>`);
    }
    select.value = value;
  }

  function fillForm(spec) {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("That is not an app spec.");
    const unknown = Object.keys(spec).filter((k) => !KNOWN_KEYS.includes(k));

    setVal("name", spec.name);
    setVal("title", spec.title);
    setVal("description", spec.description);
    setVal("version", spec.version || "0.1.0");
    setVal("visibility", spec.visibility || "public");
    setVal("maintainers", (spec.maintainers || []).join(", "));
    setVal("workshop-url", spec.workshop_url);

    const interfaces = Array.isArray(spec.interfaces) ? spec.interfaces : ["jupyter"];
    for (const input of document.querySelectorAll('input[name="interface"]')) input.checked = interfaces.includes(input.value);

    const res = spec.resources || {};
    const wall = res.wall_time_hours || {};
    const features = spec.features || {};
    const gpu = features.gpu || {};
    setVal("cpu", res.cpu ?? (gpu.enabled ? 4 : 2));
    setVal("memory", res.memory_gb ?? (gpu.enabled ? 8 : 4));
    setVal("wall-default", wall.default ?? 8);
    setVal("wall-min", wall.min ?? Math.min(4, wall.default ?? 8));
    setVal("wall-max", wall.max ?? Math.max(12, wall.default ?? 8));

    $("gpu-enabled").checked = Boolean(gpu.enabled);
    for (const radio of document.querySelectorAll('input[name="gpu-mode"]')) radio.checked = radio.value === (gpu.mode || "all");
    const cards = Array.isArray(gpu.cards) ? gpu.cards : CARDS.map((c) => c.id);
    for (const c of CARDS) $(`card-${c.id}`).checked = cards.includes(c.id);
    setVal("gpu-vram", gpu.vram || "200MiB");
    $("gpu-pytorch").checked = gpu.pytorch !== false;
    $("gpu-numba").checked = gpu.numba !== false;
    $("gpu-form").checked = gpu.session_form !== false;
    const slurm = features.slurm || {};
    $("slurm-enabled").checked = Boolean(slurm.enabled) || Boolean(gpu.enabled);
    setVal("slurm-partition", slurm.partition && !gpu.enabled ? slurm.partition : "milan");
    setVal("slurm-node", slurm.node_name && !gpu.enabled ? slurm.node_name : "c001");
    $("lmod-enabled").checked = Boolean(features.lmod && features.lmod.enabled);

    const sw = spec.software || {};
    const conda = sw.conda || {};
    const r = sw.r || {};
    setVal("sw-conda", (conda.packages || []).join("\n"));
    setVal("sw-channels", (conda.channels || DEFAULTS.channels.split(", ")).join(", "));
    setVal("sw-pip", (sw.pip || []).join("\n"));
    setVal("sw-apt", (sw.apt || []).join("\n"));
    setVal("sw-cran", (r.cran || []).join("\n"));
    setVal("sw-bioc", (r.bioconductor || []).join("\n"));
    setVal("sw-rgithub", (r.github || []).join("\n"));
    setVal("sw-vscode", (sw.vscode_extensions || []).join("\n"));

    dataRows = [];
    for (const item of spec.data || []) {
      if (item.type === "url") {
        addRow("url", {
          url: item.url || "",
          extract: item.extract === undefined ? "auto" : item.extract ? "yes" : "no",
          sha256: item.sha256 || "",
          dest: item.dest || "",
        });
      } else {
        addRow("github", { repo: item.repo || "", ref: item.ref || "", path: item.path || "", dest: item.dest || "" });
      }
    }
    renderRows();

    const adv = spec.advanced || {};
    setVal("start-dir", adv.start_dir);
    setVal("rstudio-image", adv.rstudio_image || DEFAULTS.rstudioImage);
    setVersion("python-version", adv.python_version || "");
    setVersion("r-version", adv.r_version || DEFAULTS.rVersion);
    setVal("dockerfile", adv.dockerfile);
    setVal("startup", adv.startup);
    $("advanced").open = Boolean(adv.dockerfile || adv.startup || adv.start_dir || adv.python_version || spec.visibility === "private");
    return unknown;
  }

  function resetForm() {
    loaded = null;
    fillForm({ schema_version: 1, interfaces: ["jupyter"] });
    $("result").hidden = true;
    $("loaded-note").hidden = true;
  }

  function showLoaded() {
    const note = $("loaded-note");
    if (loaded) {
      note.innerHTML = `Editing <code>apps/${esc(loaded.name)}.yml</code>. The request will change that app; keep its name.`;
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  // --------------------------------------------------------------- request
  //
  // A request is an issue made with the app creator's "Request an app" form,
  // whose one field (id "spec") is the YAML. The app creator's Request
  // workflow reads it back from the issue body, which GitHub writes as below.

  const REQUEST_FORM = "app-request.yml";
  const MAX_URL = 7000;

  function requestTitle(spec) {
    return `App request: ${spec.title} (${spec.name})`;
  }

  function requestBody(yaml) {
    return `### App spec\n\n\`\`\`yaml\n${yaml.replace(/\n+$/, "")}\n\`\`\`\n`;
  }

  const NEXT = `A maintainer first accepts the request. The app creator then opens the pull request and test-builds every image (10 to 30 minutes), and a maintainer approves it. Once it is approved, the app's repositories are made and their images built. GitHub notifies you as it goes, and when the app is ready.`;

  function showResult(html, isError = false) {
    const box = $("result");
    box.innerHTML = html;
    box.classList.toggle("error", isError);
    box.hidden = false;
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // a new tab, without giving it a handle on this page; null if it was blocked
  function openTab(url) {
    const win = window.open(url, "_blank");
    if (win) win.opener = null;
    return win;
  }

  // GitHub's request form, filled in; the requester only presses Create
  function openRequestForm({ title, yaml }) {
    const form = `${CREATOR}/issues/new?${new URLSearchParams({ template: REQUEST_FORM, title })}`;
    let url = `${form}&${new URLSearchParams({ spec: yaml })}`;
    const tooLong = url.length > MAX_URL;
    if (tooLong) url = form;
    // start copying while this page still has focus; the new tab takes it
    const copying = tooLong ? copyText(yaml) : Promise.resolve(false);
    const win = openTab(url);
    const link = `<a href="${esc(url)}" target="_blank" rel="noopener">the request form</a>`;
    if (tooLong) {
      copying.then((copied) =>
        showResult(`
          <p><strong>The request is too long to put in a link${copied ? ", so it is on your clipboard" : "; copy the spec from below"}.</strong>
          ${win ? "GitHub opened in a new tab" : `Open ${link}`}: paste it into the <em>App spec</em> box, then press <strong>Create</strong>.</p>
          <p>${NEXT}</p>`),
      );
      return;
    }
    showResult(`
      <p><strong>${win ? "GitHub opened in a new tab" : `Open ${link}`}, with your request filled in: press <em>Create</em> there.</strong> That is all.</p>
      <p>${NEXT}</p>
      <p class="hint">GitHub may ask you to sign in first.</p>`);
  }

  // when filing a request fails: GitHub's request form still works
  function formFallback(pending) {
    return pending ? `<p><button type="button" class="link-button" id="use-form">Open GitHub's request form instead</button>, and press <em>Create</em> there.</p>` : "";
  }

  function wireFormFallback(pending) {
    const button = $("use-form");
    if (button) button.addEventListener("click", () => openRequestForm(pending));
  }

  // signed in, the request is filed straight away, as the signed-in person
  async function fileRequest(pending, { justSignedIn = false } = {}) {
    const auth = account();
    if (!auth) {
      await signIn(pending);
      return;
    }
    busy = true;
    render();
    try {
      const issue = await gh(`/repos/${OWNER}/${REPO}/issues`, {
        method: "POST",
        token: auth.token,
        body: { title: pending.title, body: requestBody(pending.yaml), labels: ["app request"] },
      });
      showResult(`
        <p><strong>Request #${issue.number} is in:</strong> <a href="${esc(issue.html_url)}" target="_blank" rel="noopener">${esc(issue.title)}</a>, filed as @${esc(auth.login)}. Nothing else is needed.</p>
        <p>${NEXT}</p>`);
    } catch (e) {
      if (e.status === 401 && !justSignedIn) {
        // the sign-in ran out or was withdrawn: sign in again, which GitHub
        // does without asking once the app creator is authorised
        store(KEYS.auth, null, "session");
        await signIn(pending);
        return;
      }
      const hint =
        e.status === 403 || e.status === 404 || e.status === 410
          ? "GitHub would not let the sign-in file it. The app creator's sign-in App may not be installed on the app creator repository yet."
          : "";
      showResult(`<p><strong>The request was not sent.</strong> ${esc(e.message)}</p>${hint ? `<p>${esc(hint)}</p>` : ""}${formFallback(pending)}`, true);
      wireFormFallback(pending);
    } finally {
      busy = false;
      render();
    }
  }

  function createPullRequest() {
    const spec = readSpec();
    const { errors } = validate(spec);
    if (errors.length) {
      render();
      return;
    }
    const pending = { title: requestTitle(spec), yaml: toYaml(spec) };
    if (CAN_SIGN_IN) fileRequest(pending);
    else openRequestForm(pending);
  }

  // ---------------------------------------------------------------- dialogs

  function applyYaml(text) {
    // eslint-disable-next-line no-undef
    const spec = jsyaml.load(text);
    const unknown = fillForm(spec);
    render();
    return unknown;
  }

  async function openLoadDialog() {
    const dialog = $("load-dialog");
    const select = $("load-select");
    const error = $("load-error");
    error.textContent = "";
    select.innerHTML = "";
    $("load-intro").textContent = "Loading the apps...";
    dialog.showModal();
    try {
      const listing = await gh(`/repos/${OWNER}/${REPO}/contents/apps?ref=${BRANCH}`, { allow: [404] });
      const apps = (listing || []).filter((f) => f.type === "file" && f.name.endsWith(".yml"));
      if (!apps.length) {
        $("load-intro").textContent = "There are no apps yet.";
        return;
      }
      $("load-intro").innerHTML = "Choose an app from <code>apps/</code>. Your request will change it.";
      select.innerHTML = apps.map((f) => `<option value="${esc(f.path)}">${esc(f.name.replace(/\.yml$/, ""))}</option>`).join("");
      select.selectedIndex = 0;
    } catch (e) {
      $("load-intro").textContent = "";
      error.textContent = `Could not list the apps: ${e.message}`;
    }
  }

  async function loadSelectedApp() {
    const path = $("load-select").value;
    if (!path) return;
    const error = $("load-error");
    try {
      const file = await gh(`/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`);
      const unknown = applyYaml(base64ToUtf8(file.content));
      loaded = { name: readSpec().name, sha: file.sha };
      showLoaded();
      render();
      $("load-dialog").close();
      if (unknown.length) showResult(`<p>Loaded, but these fields are not on this form and will be dropped: ${unknown.map(esc).join(", ")}</p>`, true);
    } catch (e) {
      error.textContent = `Could not load it: ${e.message}`;
    }
  }

  // -------------------------------------------------------------- wiring up

  function buildControls() {
    $("gpu-cards").innerHTML = CARDS.map(
      (c) => `<label class="chip"><input type="checkbox" id="card-${c.id}" value="${c.id}" checked><span>${esc(c.label)} <small>${esc(c.memory)}</small></span></label>`,
    ).join("");
    $("gpu-vram").innerHTML = VRAM.map(([v, label]) => `<option value="${v}"${v === "200MiB" ? " selected" : ""}>${esc(label)}</option>`).join("");
    renderBrowserTabs();
    renderVersionMenus();
  }

  function wire() {
    const form = $("app-form");
    form.addEventListener("submit", (e) => e.preventDefault());
    form.addEventListener("input", (e) => {
      const t = e.target;
      if (t.id === "browse-search") return;
      if (t.dataset && t.dataset.row) {
        const row = rowById(t.dataset.row);
        if (row) row[t.dataset.key] = t.value;
      }
      render();
    });
    form.addEventListener("change", (e) => {
      const t = e.target;
      if (t.id === "browse-search") return;
      if (t.id === "gpu-enabled" && t.checked) {
        if (num("cpu") < 4) setVal("cpu", 4);
        if (num("memory") < 8) setVal("memory", 8);
      }
      if (t.dataset && t.dataset.key === "repo") {
        const row = rowById(t.dataset.row);
        const parsed = parseGithub(t.value);
        if (row && parsed) {
          row.repo = parsed.repo;
          if (parsed.ref && !row.ref) row.ref = parsed.ref;
          if (parsed.path && !row.path) row.path = parsed.path;
          renderRows();
        }
      }
      render();
    });
    $("name").addEventListener("blur", () => {
      const el = $("name");
      const fixed = el.value.trim().toLowerCase().replace(/[\s_]+/g, "-");
      if (fixed !== el.value) {
        el.value = fixed;
        render();
      }
    });

    $("data-rows").addEventListener("click", (e) => {
      const remove = e.target.closest("[data-remove]");
      if (remove) {
        dataRows = dataRows.filter((r) => r.id !== Number(remove.dataset.remove));
        renderRows();
        render();
        return;
      }
      const pin = e.target.closest("[data-pin]");
      if (pin) pinRow(rowById(pin.dataset.pin));
    });
    $("add-github").addEventListener("click", () => {
      addRow("github");
      renderRows();
      render();
      $(`repo-${rowSeq}`).focus();
    });
    $("add-url").addEventListener("click", () => {
      addRow("url");
      renderRows();
      render();
      $(`url-${rowSeq}`).focus();
    });
    // the package browser
    $("browse").addEventListener("toggle", () => {
      if ($("browse").open) openList(browsing);
    });
    $("browse-tabs").addEventListener("click", (e) => {
      const tab = e.target.closest("[data-list]");
      if (tab) openList(LISTS.find((l) => l.id === tab.dataset.list));
    });
    $("browse-tabs").addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      const next = LISTS[(LISTS.indexOf(browsing) + step + LISTS.length) % LISTS.length];
      openList(next).then(() => $(`browse-tab-${next.id}`).focus());
      e.preventDefault();
    });
    $("browse-search").addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(filterList, 120);
    });
    $("browse-list").addEventListener("scroll", () => requestAnimationFrame(drawRows), { passive: true });
    $("browse-rows").addEventListener("keydown", (e) => {
      const row = e.target.closest(".browse-row");
      const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 }[e.key];
      if (!row || !step) return;
      stepRow(Number(row.dataset.i), step);
      e.preventDefault();
    });
    $("browse-search").addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && shown.length) {
        $("browse-list").scrollTop = 0;
        stepRow(0, 0);
        e.preventDefault();
      }
    });
    $("browse-rows").addEventListener("click", (e) => {
      const row = e.target.closest(".browse-row");
      if (row && shown[Number(row.dataset.i)]) togglePackage(browsing, shown[Number(row.dataset.i)].name);
    });

    $("create-pr").addEventListener("click", createPullRequest);

    $("copy-yaml").addEventListener("click", async () => {
      const ok = await copyText($("yaml-preview").textContent);
      $("copy-yaml").textContent = ok ? "Copied" : "Copy failed";
      setTimeout(() => ($("copy-yaml").textContent = "Copy"), 1500);
    });
    $("download-yaml").addEventListener("click", () => {
      const spec = readSpec();
      const blob = new Blob([toYaml(spec)], { type: "text/yaml" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${RE.name.test(spec.name) ? spec.name : "app"}.yml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    $("reset").addEventListener("click", () => {
      if (window.confirm("Clear the form and start again?")) {
        resetForm();
        store(KEYS.draft, null);
        render();
      }
    });

    // import
    $("import-open").addEventListener("click", () => {
      $("import-error").textContent = "";
      $("import-dialog").showModal();
    });
    $("import-file").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (file) $("import-text").value = await file.text();
    });
    $("import-apply").addEventListener("click", () => {
      try {
        loaded = null;
        const unknown = applyYaml($("import-text").value);
        showLoaded();
        $("import-dialog").close();
        if (unknown.length) showResult(`<p>Imported, but these fields are not on this form and were dropped: ${unknown.map(esc).join(", ")}</p>`, true);
      } catch (e) {
        $("import-error").textContent = `Could not import it: ${e.message}`;
      }
    });

    // existing apps
    $("load-open").addEventListener("click", openLoadDialog);
    $("load-apply").addEventListener("click", loadSelectedApp);
    $("load-select").addEventListener("dblclick", loadSelectedApp);

  }

  function restoreDraft() {
    const raw = recall(KEYS.draft);
    if (!raw) return false;
    try {
      const draft = JSON.parse(raw);
      fillForm(draft.spec);
      if (Array.isArray(draft.rows)) {
        dataRows = draft.rows.map((r) => ({ ...r, id: ++rowSeq }));
        renderRows();
      }
      loaded = draft.loaded || null;
      showLoaded();
      return true;
    } catch {
      return false;
    }
  }

  function start() {
    buildControls();
    wire();
    // save straight away when the page goes, rather than lose the last edit
    // to the save delay - e.g. when the pull request opens in a new tab
    window.addEventListener("pagehide", () => saveDraft());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") saveDraft();
    });
    if (!restoreDraft()) resetForm();
    renderAccount();
    render();
    loadVersions();
    if (CAN_SIGN_IN) finishSignIn();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
