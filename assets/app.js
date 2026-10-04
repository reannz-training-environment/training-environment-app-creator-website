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
  const SIGN_IN = window.APP_CREATOR_SIGN_IN || { clientId: "", helper: "" };
  const CAN_SIGN_IN = Boolean(SIGN_IN.clientId && SIGN_IN.helper);
  // where GitHub sends people back to: the sign-in App's callback URL
  const HOME = `${location.origin}${location.pathname.replace(/index\.html$/, "")}`;
  const DEFAULTS = { rstudioImage: "rocker/rstudio", rVersion: "4.5.3", channels: "conda-forge, bioconda" };

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

  const PRESETS = [
    {
      title: "Bioinformatics",
      target: "sw-conda",
      note: "conda",
      items: ["samtools", "bcftools", "bwa", "bowtie2", "minimap2", "fastqc", "multiqc", "fastp", "seqkit", "blast", "hisat2", "salmon", "star", "subread", "spades", "kraken2"],
    },
    { title: "Workflows", target: "sw-conda", note: "conda", items: ["nextflow", "snakemake"] },
    {
      title: "Python",
      target: "sw-pip",
      note: "pip",
      items: ["numpy", "pandas", "matplotlib", "scipy", "seaborn", "scikit-learn", "plotly", "ipywidgets"],
    },
    {
      title: "R",
      target: "sw-cran",
      note: "CRAN",
      items: ["tidyverse", "ggplot2", "dplyr", "readr", "rmarkdown", "knitr", "here", "palmerpenguins", "vegan"],
    },
    { title: "Bioconductor", target: "sw-bioc", note: "Bioconductor", items: ["DESeq2", "edgeR", "limma", "GenomicRanges", "Biostrings"] },
    { title: "Command line", target: "sw-apt", note: "apt", items: ["parallel", "pigz", "tmux", "bc", "ncdu"] },
    {
      title: "VS Code",
      target: "sw-vscode",
      note: "extensions",
      items: ["ms-python.python", "ms-toolsai.jupyter", "REditorSupport.r", "redhat.vscode-yaml", "nextflow.nextflow"],
    },
  ];

  // ------------------------------------------------------------------ state

  let dataRows = [];
  let rowSeq = 0;
  let loaded = null; // {name, sha}: the existing app this form edits
  const repoState = new Map(); // owner/repo -> "exists" | "new" | "unknown" | "checking"
  const specState = new Map(); // app name -> "exists" | "new"
  let availabilityTimer = null;
  let draftTimer = null;
  let busy = false;

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
      store(KEYS.auth, JSON.stringify({ token: data.access_token, login: user.login, expires }), "session");
    } catch (e) {
      fail(e.message);
      return;
    }
    renderAccount();
    render();
    if (pending) await fileRequest(pending, { justSignedIn: true });
  }

  function renderAccount() {
    const el = $("account");
    const auth = CAN_SIGN_IN && account();
    el.hidden = !auth;
    el.innerHTML = auth ? `Signed in to GitHub as <strong>@${esc(auth.login)}</strong>. <button type="button" class="link-button" id="sign-out">Sign out</button>` : "";
    if (auth) $("sign-out").addEventListener("click", signOut);
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
    if (interfaces.includes("rstudio")) {
      advanced.rstudio_image = val("rstudio-image");
      advanced.r_version = val("r-version").trim();
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
    if (adv.r_version !== undefined && !RE.version.test(adv.r_version)) err("The R version must look like 4.5.3.", "r-version");
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

  // --------------------------------------------------------------- presets

  function renderPresets() {
    $("presets").innerHTML = PRESETS.map(
      (group, gi) => `
      <div class="preset-group">
        <h3>${esc(group.title)} <code>${esc(group.note)}</code></h3>
        ${group.items
          .map((item) => `<button type="button" class="preset" data-group="${gi}" data-item="${esc(item)}" aria-pressed="false">${esc(item)}</button>`)
          .join("")}
      </div>`,
    ).join("");
  }

  function updatePresets() {
    for (const button of document.querySelectorAll(".preset")) {
      const group = PRESETS[Number(button.dataset.group)];
      const present = items($(group.target).value, group.target !== "sw-conda" && group.target !== "sw-pip").map(presetKey);
      button.setAttribute("aria-pressed", String(present.includes(presetKey(button.dataset.item))));
    }
  }

  function presetKey(item) {
    return condaName(item);
  }

  function togglePreset(button) {
    const group = PRESETS[Number(button.dataset.group)];
    const area = $(group.target);
    const item = button.dataset.item;
    const lines = area.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const idx = lines.findIndex((l) => presetKey(l) === presetKey(item));
    if (idx >= 0) lines.splice(idx, 1);
    else lines.push(item);
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
    for (const id of ["name", "title", "version", "maintainers", "workshop-url", "cpu", "memory", "wall-default", "wall-min", "slurm-partition", "slurm-node", "start-dir", "r-version", "sw-channels"]) {
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

    $("yaml-preview").textContent = toYaml(spec);
    updatePresets();

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
    setVal("r-version", adv.r_version || DEFAULTS.rVersion);
    setVal("dockerfile", adv.dockerfile);
    setVal("startup", adv.startup);
    $("advanced").open = Boolean(adv.dockerfile || adv.startup || adv.start_dir || spec.visibility === "private");
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

  const NEXT = `The app creator then opens the pull request and test-builds every image (10 to 30 minutes), and a maintainer approves it. Once it is approved, the app's repositories are made and their images built. GitHub notifies you as it goes, and when the app is ready.`;

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
    renderPresets();
  }

  function wire() {
    const form = $("app-form");
    form.addEventListener("submit", (e) => e.preventDefault());
    form.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.row) {
        const row = rowById(t.dataset.row);
        if (row) row[t.dataset.key] = t.value;
      }
      render();
    });
    form.addEventListener("change", (e) => {
      const t = e.target;
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
    $("presets").addEventListener("click", (e) => {
      const button = e.target.closest(".preset");
      if (button) togglePreset(button);
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
    if (CAN_SIGN_IN) finishSignIn();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
