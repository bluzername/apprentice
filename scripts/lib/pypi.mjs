/**
 * Minimal PyPI metadata client used to resolve compatible pins for the MLX
 * route. Pure helpers are exported for tests; network calls take fetchImpl.
 */
export const PYPI_BASE = "https://pypi.org/pypi";

const STABLE_VERSION_RE = /^\d+(\.\d+)*$/;

/** Parses a PEP 508 requirement string into { name, extras, specifiers, marker }. */
export function parseRequirement(spec) {
  const [requirement, marker] = spec.split(";").map((part) => part.trim());
  const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[([^\]]*)\])?\s*(.*)$/.exec(requirement);
  if (!match) {
    throw new Error(`Unparseable requirement: ${spec}`);
  }
  const [, name, extras = "", specifierText] = match;
  const specifiers = specifierText
    .replace(/^\(|\)$/g, "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const spec = /^(===|==|!=|<=|>=|~=|<|>)\s*(.+)$/.exec(part);
      if (!spec) {
        throw new Error(`Unparseable specifier "${part}" in ${spec}`);
      }
      return { op: spec[1], version: spec[2] };
    });
  return {
    name: name.toLowerCase().replace(/_/g, "-"),
    extras: extras
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean),
    specifiers,
    marker: marker ?? null
  };
}

export function compareVersions(a, b) {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return Math.sign(diff);
    }
  }
  return 0;
}

export function satisfies(version, specifiers) {
  return specifiers.every(({ op, version: target }) => {
    const cmp = compareVersions(version, target);
    switch (op) {
      case "==":
      case "===":
        return cmp === 0;
      case "!=":
        return cmp !== 0;
      case ">=":
        return cmp >= 0;
      case ">":
        return cmp > 0;
      case "<=":
        return cmp <= 0;
      case "<":
        return cmp < 0;
      case "~=": {
        const parts = target.split(".");
        const upper = [...parts.slice(0, -2), String(Number(parts[parts.length - 2]) + 1)].join(".");
        return cmp >= 0 && compareVersions(version, upper) < 0;
      }
      default:
        throw new Error(`Unsupported specifier operator ${op}`);
    }
  });
}

/** Picks the newest stable version from `versions` satisfying `specifiers`. */
export function pickPin(versions, specifiers) {
  const candidates = versions.filter((v) => STABLE_VERSION_RE.test(v) && satisfies(v, specifiers));
  if (candidates.length === 0) {
    return null;
  }
  return candidates.sort(compareVersions).at(-1);
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`PyPI request failed: HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

export async function fetchPypiRelease(name, version, { fetchImpl = globalThis.fetch } = {}) {
  const data = await fetchJson(`${PYPI_BASE}/${name}/${version}/json`, fetchImpl);
  return {
    name,
    version: data.info.version,
    requiresPython: data.info.requires_python ?? null,
    requiresDist: data.info.requires_dist ?? [],
    files: (data.urls ?? []).map((u) => u.filename)
  };
}

export async function fetchPypiProject(name, { fetchImpl = globalThis.fetch } = {}) {
  const data = await fetchJson(`${PYPI_BASE}/${name}/json`, fetchImpl);
  return {
    name,
    latest: data.info.version,
    versions: Object.keys(data.releases ?? {}),
    releases: data.releases ?? {}
  };
}

function hasMacArm64Wheel(files) {
  return files.some((file) => /macosx.*arm64\.whl$/.test(file.filename ?? file) || /py3-none-any\.whl$/.test(file.filename ?? file));
}

/**
 * Resolves pins for mlx and transformers that satisfy the requires_dist of
 * mlx-vlm@version and ship a macOS arm64 (or pure python) wheel.
 */
export async function resolveMlxPins(mlxVlmVersion, { fetchImpl = globalThis.fetch, packages = ["mlx", "transformers"] } = {}) {
  const release = await fetchPypiRelease("mlx-vlm", mlxVlmVersion, { fetchImpl });
  const requirements = release.requiresDist.map(parseRequirement).filter((r) => r.marker === null);
  const pins = { "mlx-vlm": release.version };
  for (const pkg of packages) {
    const requirement = requirements.find((r) => r.name === pkg);
    if (!requirement) {
      throw new Error(`mlx-vlm ${mlxVlmVersion} does not declare a dependency on ${pkg}`);
    }
    const project = await fetchPypiProject(pkg, { fetchImpl });
    const versions = project.versions.filter((v) => hasMacArm64Wheel(project.releases[v] ?? []));
    const pin = pickPin(versions, requirement.specifiers);
    if (!pin) {
      throw new Error(`No ${pkg} release satisfies ${JSON.stringify(requirement.specifiers)} with a macOS arm64 wheel`);
    }
    pins[pkg] = pin;
  }
  return {
    pins,
    requiresPython: release.requiresPython,
    resolvedAt: new Date().toISOString(),
    source: `${PYPI_BASE}/mlx-vlm/${mlxVlmVersion}/json`
  };
}
