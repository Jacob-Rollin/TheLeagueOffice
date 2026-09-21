/**
 * Cross-platform player identity helpers for league activity / transactions.
 * Public warehouse rows map by sleeper_id + player_name — resolvers prefer
 * exact / sanitized name matching over foreign platform numeric ids.
 */

export type TransactionPlayerCacheEntry = {
  id: string;
  name: string;
  pos: string;
  team: string;
  /** Optional foreign key — never required for resolution. */
  espn_id?: string | number | null;
  espnId?: string | number | null;
  full_name?: string | null;
  player_name?: string | null;
  position?: string | null;
  player_id?: string | null;
};

export type ResolvedTransactionPlayer = {
  id: string;
  name: string;
  team: string;
  pos: string;
};

export type TransactionPlayerCacheIndex = {
  bySleeper: Map<string, TransactionPlayerCacheEntry>;
  byEspn: Map<string, TransactionPlayerCacheEntry>;
  byName: Map<string, TransactionPlayerCacheEntry>;
};

export function sanitizePlayerSearchName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Strip accidental negative signs / non-digit artifacts from transaction player
 * ids (ESPN D/ST overflow keys, scraper index corruption, etc.).
 * `-16001` and `"espn:-16001"` both become `"16001"`.
 */
export function sanitizeTransactionPlayerId(
  rawId: string | number | null | undefined,
): string {
  if (rawId == null) return "";
  const asText = String(rawId).trim();
  if (!asText) return "";

  const asNum = Number(asText);
  if (Number.isFinite(asNum) && /^-?\d+(\.\d+)?$/.test(asText)) {
    return String(Math.abs(asNum));
  }

  return asText.replace(/[^0-9]/g, "").trim();
}

function entryDisplayName(entry: TransactionPlayerCacheEntry): string {
  return (
    entry.full_name ||
    entry.player_name ||
    entry.name ||
    ""
  ).trim();
}

function toResolved(
  hit: TransactionPlayerCacheEntry,
  rawIdLabel: string,
  fallbackName: string,
): ResolvedTransactionPlayer {
  return {
    id: String(hit.id || hit.player_id || rawIdLabel).trim(),
    name: (entryDisplayName(hit) || fallbackName || `Player ${rawIdLabel}`).trim(),
    team: (hit.team || "FA").trim() || "FA",
    pos: (hit.position || hit.pos || "FA").trim() || "FA",
  };
}

/** Build lookup tables from the local fantasy player catalog. */
export function buildTransactionPlayerCache(
  players: TransactionPlayerCacheEntry[] | null | undefined,
): TransactionPlayerCacheIndex {
  const bySleeper = new Map<string, TransactionPlayerCacheEntry>();
  const byEspn = new Map<string, TransactionPlayerCacheEntry>();
  const byName = new Map<string, TransactionPlayerCacheEntry>();

  for (const raw of players ?? []) {
    if (!raw) continue;
    const id = String(raw.id || raw.player_id || "").trim();
    if (!id) continue;
    const entry: TransactionPlayerCacheEntry = {
      ...raw,
      id,
      name: entryDisplayName(raw) || `Player ${id}`,
      pos: (raw.position || raw.pos || "FA").trim() || "FA",
      team: (raw.team || "FA").trim() || "FA",
      espn_id: raw.espn_id ?? raw.espnId ?? null,
    };
    bySleeper.set(id, entry);

    const espnRaw = entry.espn_id ?? entry.espnId;
    if (espnRaw != null) {
      const espnKey = sanitizeTransactionPlayerId(espnRaw);
      if (espnKey) byEspn.set(espnKey, entry);
    }

    const nameKey = sanitizePlayerSearchName(entry.name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, entry);
  }

  return { bySleeper, byEspn, byName };
}

export type ActivePlayerCache =
  | TransactionPlayerCacheIndex
  | Record<string, TransactionPlayerCacheEntry>
  | TransactionPlayerCacheEntry[]
  | null
  | undefined;

function asCacheEntries(
  cache: TransactionPlayerCacheIndex | Record<string, TransactionPlayerCacheEntry>,
): TransactionPlayerCacheEntry[] {
  if ("bySleeper" in cache) {
    return [...(cache as TransactionPlayerCacheIndex).bySleeper.values()];
  }
  return Object.values(cache as Record<string, TransactionPlayerCacheEntry>);
}

function findByPlayerName(
  entries: TransactionPlayerCacheEntry[],
  incomingName: string,
  hostPos?: string,
): TransactionPlayerCacheEntry | undefined {
  const needle = sanitizePlayerSearchName(incomingName);
  if (!needle) return undefined;
  const posNeedle = (hostPos ?? "").trim().toUpperCase();

  // Exact sanitized full-name match.
  let hit = entries.find(
    (p) => sanitizePlayerSearchName(entryDisplayName(p)) === needle,
  );
  if (hit) return hit;

  // Name + weapon position context (disambiguate common last names).
  if (posNeedle && posNeedle !== "FA") {
    hit = entries.find((p) => {
      const catalogName = sanitizePlayerSearchName(entryDisplayName(p));
      if (!catalogName) return false;
      if (catalogName !== needle && !catalogName.includes(needle) && !needle.includes(catalogName)) {
        return false;
      }
      const pos = String(p.position || p.pos || "")
        .trim()
        .toUpperCase();
      return pos === posNeedle;
    });
    if (hit) return hit;
  }

  // Soft contains match when the host name is long enough to be unique.
  if (needle.length >= 6) {
    hit = entries.find((p) => {
      const catalogName = sanitizePlayerSearchName(entryDisplayName(p));
      return (
        catalogName.includes(needle) ||
        (catalogName.length >= 6 && needle.includes(catalogName))
      );
    });
  }
  return hit;
}

/**
 * Fixed local ESPN fantasy id → display name dictionary.
 * Rescues transaction ghosts when `player_warehouse` has no espn_id column.
 */
export const espnIdNameMap: Record<
  string,
  { name: string; team: string; pos: string }
> = {
  "4426338": { name: "Bo Nix", team: "DEN", pos: "QB" },
  "4871023": { name: "Jeremy Harris", team: "FA", pos: "CB" },
  "16007": { name: "Kemal Ishmael", team: "FA", pos: "SS" },
};

/**
 * Resolve a transaction player against the working global players cache.
 * Check the fixed ESPN id dictionary first, then Sleeper ids, then names.
 *
 * Signature: `(rawId, leagueType, activeCache, opts)`.
 */
export function resolvePlayerCacheData(
  rawId: string | number | null | undefined,
  _leagueType?: string | null,
  activeCache?: ActivePlayerCache,
  opts?: {
    playerNameText?: string | null;
    playerName?: string | null;
    player_name?: string | null;
    full_name?: string | null;
    pos?: string | null;
    team?: string | null;
  },
): ResolvedTransactionPlayer {
  const hostName = (
    opts?.playerNameText ??
    opts?.playerName ??
    opts?.player_name ??
    opts?.full_name ??
    ""
  ).trim();
  const hostPos = (opts?.pos ?? "").trim().toUpperCase();
  const ghostHostName = !hostName || /^Player\s+\d+$/i.test(hostName);

  const rawIdStr =
    rawId === undefined || rawId === null ? "" : String(rawId).trim();
  const cleanIdStr = rawIdStr ? sanitizeTransactionPlayerId(rawId) || rawIdStr : "";

  // Prefer an explicit cache, then the synchronous window.globalPlayersCache.
  let cache: TransactionPlayerCacheIndex | Record<string, TransactionPlayerCacheEntry> | null | undefined =
    Array.isArray(activeCache)
      ? buildTransactionPlayerCache(activeCache)
      : activeCache;

  const windowCache =
    typeof window !== "undefined"
      ? (window as Window & {
          globalPlayersCache?: Record<string, TransactionPlayerCacheEntry>;
        }).globalPlayersCache
      : undefined;

  if (
    (!cache ||
      ("bySleeper" in cache
        ? (cache as TransactionPlayerCacheIndex).bySleeper.size === 0
        : Object.keys(cache as object).length === 0)) &&
    windowCache &&
    Object.keys(windowCache).length > 0
  ) {
    cache = windowCache;
  }

  const entries = cache ? asCacheEntries(cache) : [];

  // 1) Fixed local ESPN cross-reference — rescue known transaction ghosts instantly.
  if (cleanIdStr && espnIdNameMap[cleanIdStr]) {
    const fixed = espnIdNameMap[cleanIdStr]!;
    const upgraded = findByPlayerName(entries, fixed.name, fixed.pos);
    if (upgraded) {
      return toResolved(upgraded, cleanIdStr, fixed.name);
    }
    return {
      id: cleanIdStr,
      name: fixed.name,
      team: fixed.team,
      pos: fixed.pos,
    };
  }

  if (!cache) {
    return {
      id: cleanIdStr || "unknown",
      name: !ghostHostName ? hostName : cleanIdStr ? `Player ${rawIdStr}` : "Unknown Player",
      team: (opts?.team ?? "FA").trim() || "FA",
      pos: hostPos || "FA",
    };
  }

  // 2) Direct Sleeper id slot — only when the id is already a catalog key.
  if (cleanIdStr || rawIdStr) {
    if (!("bySleeper" in cache)) {
      const dict = cache as Record<string, TransactionPlayerCacheEntry>;
      const direct = (rawIdStr && dict[rawIdStr]) || (cleanIdStr && dict[cleanIdStr]);
      if (direct) {
        return toResolved(
          {
            ...direct,
            id: String(direct.id || direct.player_id || cleanIdStr).trim(),
            name: entryDisplayName(direct) || hostName || `Player ${rawIdStr}`,
            pos: (direct.position || direct.pos || "FA").trim() || "FA",
            team: (direct.team || "FA").trim() || "FA",
          },
          cleanIdStr || rawIdStr,
          hostName,
        );
      }
    } else {
      const index = cache as TransactionPlayerCacheIndex;
      const direct =
        (rawIdStr ? index.bySleeper.get(rawIdStr) : undefined) ??
        (cleanIdStr ? index.bySleeper.get(cleanIdStr) : undefined);
      if (direct) return toResolved(direct, cleanIdStr || rawIdStr, hostName);
    }
  }

  // 3) FALLBACK UNIFIED TEXT SELECTOR — match by player_name / full_name.
  if (hostName && !ghostHostName) {
    const nameMatch = findByPlayerName(entries, hostName, hostPos);
    if (nameMatch) {
      return toResolved(nameMatch, cleanIdStr || rawIdStr || nameMatch.id, hostName);
    }
    if ("bySleeper" in cache) {
      const indexed = (cache as TransactionPlayerCacheIndex).byName.get(
        sanitizePlayerSearchName(hostName),
      );
      if (indexed) return toResolved(indexed, cleanIdStr || rawIdStr || indexed.id, hostName);
    }
  }

  // Prefer host-provided display name over numeric ghosts when catalog misses.
  return {
    id: cleanIdStr || rawIdStr || "unknown",
    name: !ghostHostName ? hostName : cleanIdStr ? `Player ${rawIdStr}` : "Unknown Player",
    team: (opts?.team ?? "FA").trim() || "FA",
    pos: hostPos || "FA",
  };
}

// ---------------------------------------------------------------------------
// Multi-platform transaction payload normalizer
// ---------------------------------------------------------------------------

export type NormalizedTransactionMove = {
  playerId: string;
  name: string;
  pos: string;
  team: string;
  action: "add" | "drop" | "ir";
};

export type NormalizedTransactionEvent = {
  id: string;
  at: number;
  kind: "waiver" | "free_agent" | "trade" | "ir" | string;
  text: string;
  teamName: string | null;
  /** Digits-only ESPN / Sleeper add id when known. */
  addedPlayer: string | null;
  /** Digits-only ESPN / Sleeper drop id when known. */
  droppedPlayer: string | null;
  /** Primary player id for single-player rows. */
  player_id: string | null;
  moves: NormalizedTransactionMove[];
};

/** Loose inbound transaction row (ESPN / Sleeper / legacy aliases). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawTxn = Record<string, any>;

function asIdCandidate(value: unknown): string | number | null | undefined {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

function readMoveName(source: RawTxn | null | undefined): string {
  if (!source) return "";
  const candidates = [
    source["name"],
    source["playerName"],
    source["fullName"],
    source["full_name"],
    source["player"]?.fullName,
    source["playerPoolEntry"]?.player?.fullName,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

function readMovePos(source: RawTxn | null | undefined): string {
  const pos =
    source?.["pos"] ??
    source?.["position"] ??
    source?.["player"]?.defaultPosition;
  return typeof pos === "string" && pos.trim() ? pos.trim() : "FA";
}

function readMoveTeam(source: RawTxn | null | undefined): string {
  const team =
    source?.["team"] ??
    source?.["nflTeam"] ??
    source?.["player"]?.proTeamAbbreviation;
  return typeof team === "string" && team.trim() ? team.trim() : "FA";
}

function inferItemAction(typeRaw: unknown): "add" | "drop" | "ir" | null {
  const type = String(typeRaw ?? "").toUpperCase();
  if (!type) return null;
  if (type.includes("DRAFT")) return null;
  if (type.includes("IR") || type.includes("INJUR")) return "ir";
  if (type.includes("ADD")) return "add";
  if (type.includes("DROP")) return "drop";
  return null;
}

/**
 * Detect native ESPN / Sleeper / legacy payload shapes and normalize them onto
 * standard global transaction fields (`addedPlayer`, `droppedPlayer`, `player_id`,
 * `moves`) before the activity-feed name resolver runs.
 */
export function normalizeTransactionEvent(
  tx: unknown,
): NormalizedTransactionEvent | null {
  if (tx == null || typeof tx !== "object") return null;
  const row = tx as RawTxn;

  // Initialize standard global data properties from flat aliases.
  let addedPlayerId: string | number | null | undefined = asIdCandidate(
    row["addedPlayer"] ?? row["added_player"] ?? null,
  );
  let droppedPlayerId: string | number | null | undefined = asIdCandidate(
    row["droppedPlayer"] ?? row["dropped_player"] ?? null,
  );
  let corePlayerId: string | number | null | undefined = asIdCandidate(
    row["player_id"] ?? row["playerId"] ?? null,
  );

  const moves: NormalizedTransactionMove[] = [];

  // DETECT NATIVE ESPN PAYLOAD STRUCTURES (items / movableSlots nests).
  const itemBags: unknown[] = [];
  if (Array.isArray(row["items"])) itemBags.push(...row["items"]);
  if (Array.isArray(row["movableSlots"])) itemBags.push(...row["movableSlots"]);
  const nestedItems = row["transaction"]?.items;
  if (Array.isArray(nestedItems)) itemBags.push(...nestedItems);

  for (const rawItem of itemBags) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as RawTxn;
    const pId = sanitizeTransactionPlayerId(
      asIdCandidate(item["playerId"] ?? item["player_id"] ?? item["id"]) ?? "",
    );
    if (!pId) continue;

    let action = inferItemAction(item["type"] ?? item["action"] ?? item["movementType"]);
    // ESPN sometimes encodes FA add/drop via toTeamId / fromTeamId only.
    if (!action) {
      const toTeam = Number(item["toTeamId"]);
      const fromTeam = Number(item["fromTeamId"]);
      const hasTo = Number.isFinite(toTeam) && toTeam > 0;
      const hasFrom = Number.isFinite(fromTeam) && fromTeam > 0;
      if (hasTo && !hasFrom) action = "add";
      else if (hasFrom && !hasTo) action = "drop";
    }
    if (!action) continue;

    if (action === "add") addedPlayerId = pId;
    if (action === "drop" || action === "ir") droppedPlayerId = pId;
    if (!corePlayerId) corePlayerId = pId;

    moves.push({
      playerId: pId,
      name: readMoveName(item) || `Player ${pId}`,
      pos: readMovePos(item),
      team: readMoveTeam(item),
      action,
    });
  }

  // Already-normalized League Activity moves (server feed) — sanitize ids.
  if (Array.isArray(row["moves"]) && row["moves"].length) {
    for (const rawMove of row["moves"]) {
      if (!rawMove || typeof rawMove !== "object") continue;
      const m = rawMove as RawTxn;
      const pId =
        sanitizeTransactionPlayerId(
          asIdCandidate(
            m["playerId"] ?? m["player_id"] ?? m["addedPlayer"] ?? m["droppedPlayer"],
          ) ?? "",
        ) || String(m["playerId"] ?? "").trim();
      if (!pId && !readMoveName(m)) continue;

      const actionRaw = String(m["action"] ?? "").toLowerCase();
      const action: NormalizedTransactionMove["action"] =
        actionRaw === "add" || actionRaw === "drop" || actionRaw === "ir"
          ? actionRaw
          : "add";

      if (action === "add") addedPlayerId = pId || addedPlayerId;
      if (action === "drop" || action === "ir") droppedPlayerId = pId || droppedPlayerId;
      if (!corePlayerId) corePlayerId = pId;

      // Prefer ESPN-derived moves when both exist for the same id+action.
      const already = moves.some(
        (x) => x.playerId === pId && x.action === action,
      );
      if (!already) {
        moves.push({
          playerId: pId || "unknown",
          name: readMoveName(m) || (pId ? `Player ${pId}` : "Unknown Player"),
          pos: readMovePos(m),
          team: readMoveTeam(m),
          action,
        });
      }
    }
  }

  // Sleeper-style adds / drops maps: { [playerId]: rosterId }
  if (row["adds"] && typeof row["adds"] === "object" && !Array.isArray(row["adds"])) {
    for (const key of Object.keys(row["adds"] as Record<string, unknown>)) {
      const pId = sanitizeTransactionPlayerId(key);
      if (!pId) continue;
      addedPlayerId = pId;
      if (!corePlayerId) corePlayerId = pId;
      if (!moves.some((m) => m.playerId === pId && m.action === "add")) {
        moves.push({
          playerId: pId,
          name: `Player ${pId}`,
          pos: "FA",
          team: "FA",
          action: "add",
        });
      }
    }
  }
  if (row["drops"] && typeof row["drops"] === "object" && !Array.isArray(row["drops"])) {
    for (const key of Object.keys(row["drops"] as Record<string, unknown>)) {
      const pId = sanitizeTransactionPlayerId(key);
      if (!pId) continue;
      droppedPlayerId = pId;
      if (!moves.some((m) => m.playerId === pId && m.action === "drop")) {
        moves.push({
          playerId: pId,
          name: `Player ${pId}`,
          pos: "FA",
          team: "FA",
          action: "drop",
        });
      }
    }
  }

  const addedPlayer = sanitizeTransactionPlayerId(addedPlayerId) || null;
  const droppedPlayer = sanitizeTransactionPlayerId(droppedPlayerId) || null;
  const player_id =
    sanitizeTransactionPlayerId(corePlayerId ?? addedPlayerId) || addedPlayer;

  // Ensure moves exist even when only flat add/drop ids were present.
  if (!moves.length) {
    if (addedPlayer) {
      moves.push({
        playerId: addedPlayer,
        name: `Player ${addedPlayer}`,
        pos: "FA",
        team: "FA",
        action: "add",
      });
    }
    if (droppedPlayer) {
      moves.push({
        playerId: droppedPlayer,
        name: `Player ${droppedPlayer}`,
        pos: "FA",
        team: "FA",
        action: "drop",
      });
    }
  }

  const kindRaw = String(row["kind"] ?? row["type"] ?? "free_agent").toLowerCase();
  const kind =
    kindRaw.includes("trade")
      ? "trade"
      : kindRaw.includes("waiver")
        ? "waiver"
        : kindRaw === "ir" || kindRaw.includes("injur")
          ? "ir"
          : kindRaw.includes("free")
            ? "free_agent"
            : String(row["kind"] ?? "free_agent");

  return {
    id: String(row["id"] ?? row["transaction_id"] ?? `${row["at"] ?? Date.now()}`),
    at:
      Number(
        row["at"] ?? row["processDate"] ?? row["proposedDate"] ?? row["created"] ?? Date.now(),
      ) || Date.now(),
    kind,
    text: typeof row["text"] === "string" ? row["text"] : "",
    teamName:
      typeof row["teamName"] === "string"
        ? row["teamName"]
        : typeof row["team_name"] === "string"
          ? row["team_name"]
          : null,
    addedPlayer,
    droppedPlayer,
    player_id,
    moves,
  };
}

/** Map a normalized payload back onto the League Activity feed event shape. */
export function normalizedToLeagueActivityEvent(
  normalized: NormalizedTransactionEvent,
): {
  id: string;
  at: number;
  kind: "waiver" | "free_agent" | "trade" | "ir";
  text: string;
  teamName: string | null;
  moves: NormalizedTransactionMove[];
  addedPlayer: string | null;
  droppedPlayer: string | null;
  player_id: string | null;
} {
  const kind: "waiver" | "free_agent" | "trade" | "ir" =
    normalized.kind === "trade" ||
    normalized.kind === "waiver" ||
    normalized.kind === "free_agent" ||
    normalized.kind === "ir"
      ? normalized.kind
      : "free_agent";

  return {
    id: normalized.id,
    at: normalized.at,
    kind,
    text: normalized.text,
    teamName: normalized.teamName,
    moves: normalized.moves,
    addedPlayer: normalized.addedPlayer,
    droppedPlayer: normalized.droppedPlayer,
    player_id: normalized.player_id,
  };
}
