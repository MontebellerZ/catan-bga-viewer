(function (root) {
  "use strict";

  const normalize = (text) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim().toLowerCase();

  function isCatanUrl(url) {
    const parsed = new URL(url);
    return /(^|\.)boardgamearena\.com$/.test(parsed.hostname)
      && /^(?:\/\d+)?\/catan\/?$/.test(parsed.pathname)
      && /^\d+$/.test(parsed.searchParams.get("table") || "");
  }

  // BGA appends timestamps and replay buttons beside the message inside the same .log node.
  function messageText(element) {
    const box = element.querySelector(".roundedbox");
    if (box) return box.textContent;
    const copy = element.cloneNode(true);
    copy.querySelectorAll(".timestamp, button, p").forEach((node) => node.remove());
    return copy.textContent;
  }

  const resources = ["lumber", "brick", "wool", "grain", "ore"];
  const emptyResources = () => Object.fromEntries(resources.map((resource) => [resource, 0]));

  // BGA writes "3<icon>" for three cards and just "<icon>" for one. Each side of a trade
  // ("A → B") sits in its own <span>, so tokens are grouped by parent in document order.
  function readResourceGroups(element) {
    const groups = new Map();
    for (const token of element.querySelectorAll(".cat_log_token")) {
      const classes = [...token.classList];
      const resource = resources.find((name) => classes.includes(`icon_${name}`));
      if (!resource) continue;
      const amount = /(\d+)\s*$/.exec(token.previousSibling?.textContent || "");
      const group = groups.get(token.parentElement) || {};
      groups.set(token.parentElement, group);
      group[resource] = (group[resource] || 0) + (amount ? Number(amount[1]) : 1);
    }
    return [...groups.values()];
  }

  function readResources(element) {
    const found = {};
    for (const group of readResourceGroups(element)) {
      for (const [resource, amount] of Object.entries(group)) found[resource] = (found[resource] || 0) + amount;
    }
    return found;
  }

  const signature = (amounts) => resources.filter((resource) => amounts[resource])
    .map((resource) => `${resource}${amounts[resource]}`).join(",");
  const cardCount = (amounts) => Object.values(amounts).reduce((sum, amount) => sum + amount, 0);

  function readLog(element, players) {
    const text = normalize(messageText(element));
    const dice = [...element.querySelectorAll(".icon_die")].map((die) => {
      const face = [...die.classList].map((name) => /^icon_die([1-6])$/.exec(name)).find(Boolean);
      return face ? Number(face[1]) : null;
    });
    const move = element.getAttribute("data-move-id");
    const identity = move ? `move:${move}` : `log:${element.id}`;
    const base = (suffix) => ({ key: `${identity}:${suffix}`, persistent: Boolean(move) });
    const byLength = [...players].sort((a, b) => b.name.length - a.name.length);

    if (dice.length === 2 && dice.every(Number.isInteger)) {
      const roller = byLength.find((player) => text.startsWith(`${normalize(player.name)} `));
      const event = { ...base("roll"), type: "roll", total: dice[0] + dice[1], faces: dice };
      if (roller) event.actor = roller.id;
      return event;
    }

    // Private notes BGA shows only to the thief/victim: they reveal which card was stolen.
    const reveal = /^(?:voce|you) (recebe|perde|gets?|loses?)\b/.exec(text);
    if (reveal) {
      const amounts = readResources(element);
      if (!Object.keys(amounts).length) return null;
      const direction = /^(?:recebe|get)/.test(reveal[1]) ? "gain" : "loss";
      return { ...base(`reveal:${direction}:${signature(amounts)}`), type: "reveal", direction, resources: amounts };
    }

    // Executed trade between players: "⇌ A dá X a B que dá Y em troca".
    if (text.startsWith("⇌ ")) {
      const body = text.slice(2);
      const actor = byLength.find((player) => body.startsWith(`${normalize(player.name)} `));
      const partner = actor && byLength.find((player) => player.id !== actor.id
        && (body.includes(` a ${normalize(player.name)} que da `) || body.includes(` to ${normalize(player.name)} who gives `)));
      const [gives, gets, ...rest] = readResourceGroups(element);
      if (!partner || !gives || !gets || rest.length) return null;
      return {
        ...base(`trade:${actor.id}:${partner.id}:${signature(gives)}>${signature(gets)}`),
        type: "trade", actor: actor.id, partner: partner.id, gives, gets, reversible: false
      };
    }

    // Match whole known names instead of splitting at "de"/"from" inside a nickname.
    for (const actor of players) {
      const name = normalize(actor.name);
      if (!text.startsWith(`${name} `)) continue;
      const action = text.slice(name.length).trim();
      if (/^(?:retrocede|desfaz a sua jogada|rolls? backs?)\b/.test(action)) {
        return { ...base(`rollback:${actor.id}`), type: "rollback", actor: actor.id };
      }
      if (/^(?:ganha|gets|gains)\b/.test(action) && !/\b(?:nada|nothing)\b/.test(action)) {
        const gained = readResources(element);
        if (!Object.keys(gained).length) return null;
        return { ...base(`gain:${actor.id}:${signature(gained)}`), type: "gain", actor: actor.id, resources: gained };
      }
      // Builds, upgrades, development cards, discards on a 7 and Monopoly losses.
      if (/^(?:constroi|melhorou|compra|descarta|perde|builds|upgrades|buys|discards|loses)\b/.test(action)) {
        const spent = readResources(element);
        if (!Object.keys(spent).length) return null;
        const reversible = /^(?:constroi|melhorou|builds|upgrades)\b/.test(action);
        const category = reversible ? "build" : /^(?:compra|buys)\b/.test(action) ? "development"
          : /^(?:descarta|discards)\b/.test(action) ? "discard"
            : /^(?:perde|loses)\b/.test(action) ? "loss" : "other";
        const construction = /^(constroi|melhorou|builds|upgrades)\s+(.+?)\s+(?:por|for)\b/.exec(action);
        const label = construction
          ? `${/^(?:constroi|builds)$/.test(construction[1]) ? "construiu" : "melhorou"} ${construction[2]}`
          : undefined;
        return {
          ...base(`spend:${actor.id}:${signature(spent)}`),
          type: "spend", actor: actor.id, resources: spent, reversible, category,
          ...(label && label.length <= 100 ? { label } : {})
        };
      }
      if (/^(?:negocia com o banco|trades with the supply)\b/.test(action)) {
        const [gives, gets, ...rest] = readResourceGroups(element);
        if (!gives || !gets || rest.length) return null;
        return {
          ...base(`trade:${actor.id}:bank:${signature(gives)}>${signature(gets)}`),
          type: "trade", actor: actor.id, partner: null, gives, gets, reversible: true
        };
      }
      // Monopoly victim without that resource: proof they hold none of it.
      if (/^(?:nao tem|doesn't have any|does not have any)\b/.test(action)) {
        const missing = readResources(element);
        if (!Object.keys(missing).length) return null;
        return { ...base(`lacks:${actor.id}:${signature(missing)}`), type: "lacks", actor: actor.id, resources: missing };
      }
      for (const victim of players) {
        if (actor.id === victim.id) continue;
        const target = normalize(victim.name);
        const portugueseSuffix = ` de ${target}`;
        const englishSuffix = ` from ${target}`;
        const portuguese = action.endsWith(portugueseSuffix)
          && /^(?:rouba|roubou)(?:\s+.*)?$/.test(action.slice(0, -portugueseSuffix.length));
        const english = action.endsWith(englishSuffix)
          && /^(?:steals?|stole)(?:\s+.*)?$/.test(action.slice(0, -englishSuffix.length));
        if (portuguese || english) {
          return { ...base(`theft:${actor.id}:${victim.id}`), type: "theft", actor: actor.id, victim: victim.id };
        }
      }
    }
    return null;
  }

  const validAmounts = (amounts) => Boolean(amounts) && typeof amounts === "object" && !Array.isArray(amounts)
    && Object.keys(amounts).length > 0 && Object.entries(amounts).every(([resource, amount]) =>
      resources.includes(resource) && Number.isInteger(amount) && amount > 0);

  function validEvent(event) {
    if (!event || typeof event.key !== "string" || typeof event.persistent !== "boolean") return false;
    if (event.seq !== undefined && !(Number.isInteger(event.seq) && event.seq >= 0)) return false;
    if (event.reversible !== undefined && typeof event.reversible !== "boolean") return false;
    if (event.category !== undefined && !["build", "development", "discard", "loss", "other"].includes(event.category)) return false;
    if (event.label !== undefined && (typeof event.label !== "string" || event.label.length > 100)) return false;
    switch (event.type) {
      case "roll":
        return Number.isInteger(event.total) && event.total >= 2 && event.total <= 12
          // Faces and roller are optional so data saved by older versions stays valid.
          && (event.faces === undefined || (Array.isArray(event.faces) && event.faces.length === 2
            && event.faces.every((face) => Number.isInteger(face) && face >= 1 && face <= 6)
            && event.faces[0] + event.faces[1] === event.total))
          && (event.actor === undefined || typeof event.actor === "string");
      case "theft":
        return typeof event.actor === "string" && typeof event.victim === "string" && event.actor !== event.victim;
      case "rollback":
        return typeof event.actor === "string";
      case "gain":
      case "spend":
      case "lacks":
        return typeof event.actor === "string" && validAmounts(event.resources);
      case "trade":
        return typeof event.actor === "string" && validAmounts(event.gives) && validAmounts(event.gets)
          && (event.partner === null || (typeof event.partner === "string" && event.partner !== event.actor));
      case "reveal":
        return (event.direction === "gain" || event.direction === "loss") && validAmounts(event.resources);
      default:
        return false;
    }
  }

  function summarize(events, players) {
    const dice = Array(13).fill(0);
    const thefts = new Map(players.map((player) => [player.id, { ...player, made: 0, suffered: 0, gains: emptyResources() }]));
    let rolls = 0;
    let robberies = 0;
    for (const event of events) {
      if (event.type === "roll") {
        dice[event.total] += 1;
        rolls += 1;
      } else if (event.type === "gain") {
        const gains = thefts.get(event.actor)?.gains;
        if (gains) for (const [resource, amount] of Object.entries(event.resources)) gains[resource] += amount;
      } else if (event.type === "theft") {
        robberies += 1;
        if (thefts.has(event.actor)) thefts.get(event.actor).made += 1;
        if (thefts.has(event.victim)) thefts.get(event.victim).suffered += 1;
      }
    }
    return { dice, rolls, robberies, players: [...thefts.values()] };
  }

  // [move logs first, move/log number, order inside the move]; events without a move ID come last.
  function eventOrder(event) {
    const match = /^(move|log):(?:log_)?(\d+):/.exec(event.key);
    return match ? [match[1] === "move" ? 0 : 1, Number(match[2]), event.seq || 0] : [2, 0, event.seq || 0];
  }

  function chronological(events) {
    return [...events].map((event) => ({ event, at: eventOrder(event) }))
      .sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1] || a.at[2] - b.at[2]);
  }

  function eventHistory(events, types) {
    const included = new Set(types);
    return chronological([...events].filter((event) => included.has(event.type))).map(({ event }) => event);
  }

  // Oldest first, ordered by BGA move number; rolls without a move ID come last.
  function rollHistory(events) {
    return eventHistory(events, ["roll"]);
  }

  function theftHistory(events) {
    return eventHistory(events, ["theft"]);
  }

  function resourceHistory(events) {
    return eventHistory(events, ["gain", "spend", "trade", "reveal"]);
  }

  // Ways to roll a number out of 36 ("pips"); 7 and missing numbers produce nothing.
  const pips = (number) => (number >= 2 && number <= 12 && number !== 7 ? 6 - Math.abs(7 - number) : 0);

  // board.hexes: { x, y, radius, resource, number, robber }; board.buildings: { x, y, owner, level }.
  // Hexes under the robber still count; robbed[resource] tells how many of those pips it blocks.
  // Positions are screen centers, so a building touches a hex when it sits on one of its corners.
  function potential(board, players) {
    const result = new Map(players.map((player) => [player.id, { ...player, pips: emptyResources(), total: 0, robbed: emptyResources() }]));
    for (const building of board.buildings) {
      const owner = result.get(building.owner);
      if (!owner) continue;
      for (const hex of board.hexes) {
        const value = pips(hex.number) * building.level;
        if (!hex.resource || !value || !(hex.radius > 0)) continue;
        if (Math.hypot(hex.x - building.x, hex.y - building.y) > hex.radius * 1.5) continue;
        owner.pips[hex.resource] += value;
        owner.total += value;
        if (hex.robber) owner.robbed[hex.resource] += value;
      }
    }
    return [...result.values()];
  }

  // Hand estimate: every card distribution ("world") the log allows, weighted by probability.
  // Spectators never see which card a theft takes, so a theft branches by the victim's hand
  // composition; later spending discards branches where someone would pay with cards they lack.
  const handTypes = new Set(["gain", "spend", "trade", "theft", "lacks", "reveal"]);
  const UNKNOWN = resources.length; // extra slot: cards of unknown type (from before the record)
  const WIDTH = resources.length + 1;
  const UNKNOWN_WEIGHT = 0.25; // chance-like factor for "the card needed was one of the unknown ones"
  const IMPOSSIBLE_WEIGHT = 1e-6; // contradicts the log; kept instead of dropped in case a log was missed
  const MAX_WORLDS = 2000;

  // totals: exact card counts shown on BGA's player panels. Whatever they hold beyond what the
  // log explains predates the record (from = first move read with this logic) and starts as unknown.
  // start: pre-record unknown counts; initialHands: guaranteed resources and unknown cards at a later checkpoint.
  function handEstimate(events, players, { from = 0, totals = {}, start: initial = {}, initialHands = {} } = {}) {
    const index = new Map(players.map((player, position) => [player.id, position]));
    const ordered = chronological([...events].filter((event) => handTypes.has(event.type)))
      .filter(({ at }) => at[0] !== 0 || at[1] >= from).map(({ event }) => event);

    // A move with a single theft plus the private "Você recebe/perde" note reveals the card.
    const revealed = new Map();
    const moves = new Map();
    for (const event of ordered) {
      const [group, move] = eventOrder(event);
      if (group !== 0) continue;
      if (!moves.has(move)) moves.set(move, []);
      moves.get(move).push(event);
    }
    for (const list of moves.values()) {
      const thefts = list.filter((event) => event.type === "theft");
      const reveal = list.find((event) => event.type === "reveal" && cardCount(event.resources) === 1);
      if (thefts.length === 1 && reveal) revealed.set(thefts[0], resources.indexOf(Object.keys(reveal.resources)[0]));
    }

    const net = players.map(() => 0);
    const thefts = players.map(() => ({ made: 0, suffered: 0, hidden: 0 }));
    const shift = (id, amounts, sign) => {
      if (index.has(id)) net[index.get(id)] += sign * cardCount(amounts);
    };
    for (const event of ordered) {
      if (event.type === "gain") shift(event.actor, event.resources, 1);
      else if (event.type === "spend") shift(event.actor, event.resources, -1);
      else if (event.type === "trade") {
        shift(event.actor, event.gets, 1);
        shift(event.actor, event.gives, -1);
        if (event.partner) {
          shift(event.partner, event.gives, 1);
          shift(event.partner, event.gets, -1);
        }
      } else if (event.type === "theft" && index.has(event.actor) && index.has(event.victim)) {
        const thief = index.get(event.actor);
        const victim = index.get(event.victim);
        net[thief] += 1;
        net[victim] -= 1;
        thefts[thief].made += 1;
        thefts[victim].suffered += 1;
        if (!revealed.has(event)) {
          thefts[thief].hidden += 1;
          thefts[victim].hidden += 1;
        }
      }
    }

    const start = Array(players.length * WIDTH).fill(0);
    players.forEach((player, position) => {
      const hand = initialHands[player.id];
      if (hand) {
        resources.forEach((resource, slot) => { start[position * WIDTH + slot] = hand.resources[resource]; });
        start[position * WIDTH + UNKNOWN] = hand.unknown;
      } else if (Number.isInteger(initial[player.id]) && initial[player.id] >= 0) start[position * WIDTH + UNKNOWN] = initial[player.id];
      else if (Number.isInteger(totals[player.id])) start[position * WIDTH + UNKNOWN] = Math.max(0, totals[player.id] - net[position]);
    });
    let worlds = [{ state: start, weight: 1, inconsistent: false }];

    // Removes cards, paying with unknown cards when needed; contradictions are fallback worlds.
    function take(state, player, slot, amount) {
      const offset = player * WIDTH;
      const known = Math.min(amount, state[offset + slot]);
      state[offset + slot] -= known;
      const unknown = Math.min(amount - known, state[offset + UNKNOWN]);
      state[offset + UNKNOWN] -= unknown;
      const missing = amount - known - unknown;
      return {
        weight: UNKNOWN_WEIGHT ** unknown * IMPOSSIBLE_WEIGHT ** missing,
        inconsistent: missing > 0
      };
    }

    function apply(event, state) {
      let factor = 1;
        let inconsistent = false;
      const actor = index.get(event.actor);
      const add = (player, amounts) => {
        if (player === undefined) return;
        for (const [resource, amount] of Object.entries(amounts)) state[player * WIDTH + resources.indexOf(resource)] += amount;
      };
      const remove = (player, amounts) => {
        if (player === undefined) return;
          for (const [resource, amount] of Object.entries(amounts)) {
            const result = take(state, player, resources.indexOf(resource), amount);
            factor *= result.weight;
            inconsistent ||= result.inconsistent;
          }
      };
      if (event.type === "gain") add(actor, event.resources);
      else if (event.type === "spend") remove(actor, event.resources);
      else if (event.type === "trade") {
        const partner = event.partner === null ? undefined : index.get(event.partner);
        remove(actor, event.gives);
        remove(partner, event.gets);
        add(actor, event.gets);
        add(partner, event.gives);
      } else if (event.type === "lacks" && actor !== undefined) {
        for (const resource of Object.keys(event.resources)) {
          if (state[actor * WIDTH + resources.indexOf(resource)]) {
            factor *= IMPOSSIBLE_WEIGHT;
            inconsistent = true;
          }
        }
      } else if (event.type === "theft") {
        const victim = index.get(event.victim);
        if (actor !== undefined && victim !== undefined) {
          const slot = revealed.get(event);
          const result = take(state, victim, slot, 1);
          factor *= result.weight;
          inconsistent ||= result.inconsistent;
          state[actor * WIDTH + slot] += 1;
        }
      }
      return { weight: factor, inconsistent };
    }

    function prune(list) {
      const consistent = list.filter((world) => !world.inconsistent);
      if (consistent.length) list = consistent;
      let kept = list.filter((world) => world.weight > 0);
      if (kept.length > MAX_WORLDS) kept = kept.sort((a, b) => b.weight - a.weight).slice(0, MAX_WORLDS);
      const keptTotal = kept.reduce((sum, world) => sum + world.weight, 0);
      for (const world of kept) world.weight /= keptTotal;
      return kept;
    }

    for (const event of ordered) {
      if (event.type === "reveal") continue;
      const next = new Map();
      const emit = (state, weight, inconsistent) => {
        if (!(weight > 0)) return;
        const key = `${state.join(",")}:${inconsistent}`;
        const found = next.get(key);
        if (found) found.weight += weight;
        else next.set(key, { state, weight, inconsistent });
      };
      const thief = index.get(event.actor);
      const victim = index.get(event.victim);
      const hidden = event.type === "theft" && !revealed.has(event);
      for (const { state, weight, inconsistent } of worlds) {
        if (!hidden) {
          const copy = state.slice();
          const result = apply(event, copy);
          emit(copy, weight * result.weight, inconsistent || result.inconsistent);
        } else if (thief === undefined || victim === undefined) {
          emit(state, weight, inconsistent);
        } else {
          const offset = victim * WIDTH;
          let size = 0;
          for (let slot = 0; slot < WIDTH; slot += 1) size += state[offset + slot];
          if (!size) {
            const copy = state.slice();
            copy[thief * WIDTH + UNKNOWN] += 1;
            emit(copy, weight * IMPOSSIBLE_WEIGHT, true);
            continue;
          }
          for (let slot = 0; slot < WIDTH; slot += 1) {
            const count = state[offset + slot];
            if (!count) continue;
            const copy = state.slice();
            copy[offset + slot] -= 1;
            copy[thief * WIDTH + slot] += 1;
            emit(copy, weight * count / size, inconsistent);
          }
        }
      }
      if (next.size) worlds = prune([...next.values()]);
    }

    return players.map((player, position) => {
      const offset = position * WIDTH;
      const hands = new Map();
      for (const { state, weight } of worlds) {
        const hand = state.slice(offset, offset + WIDTH);
        const key = hand.join(",");
        const found = hands.get(key);
        if (found) found.weight += weight;
        else hands.set(key, { hand, weight });
      }
      const options = [...hands.values()].sort((a, b) => b.weight - a.weight);
      const best = options[0];
      const result = {
        ...player, hand: emptyResources(), expected: emptyResources(), range: {},
        unknown: best.hand[UNKNOWN], total: best.hand.reduce((sum, count) => sum + count, 0),
        initial: start[offset + UNKNOWN], confidence: best.weight, thefts: thefts[position]
      };
      let certain = 0;
      resources.forEach((resource, slot) => {
        const values = options.map((option) => option.hand[slot]);
        result.hand[resource] = Math.min(...values);
        result.expected[resource] = options.reduce((sum, option) => sum + option.weight * option.hand[slot], 0);
        result.range[resource] = [Math.min(...values), Math.max(...values)];
        certain += result.range[resource][0];
      });
      // Cards beyond the per-resource minimum cannot be assigned to a guaranteed resource.
      result.unassigned = result.total - certain;
      result.consistent = !Number.isInteger(totals[player.id]) || totals[player.id] === result.total;
      return result;
    });
  }

  const api = {
    isCatanUrl, readLog, validEvent, summarize, rollHistory, theftHistory, resourceHistory, handEstimate, potential, pips, resources
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CatanStats = api;
})(globalThis);
