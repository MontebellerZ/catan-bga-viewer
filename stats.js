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

  function readLog(element, players) {
    const text = normalize(messageText(element));
    const dice = [...element.querySelectorAll(".icon_die")].map((die) => {
      const face = [...die.classList].map((name) => /^icon_die([1-6])$/.exec(name)).find(Boolean);
      return face ? Number(face[1]) : null;
    });
    const move = element.getAttribute("data-move-id");
    const identity = move ? `move:${move}` : `log:${element.id}`;

    if (dice.length === 2 && dice.every(Number.isInteger)) {
      const roller = [...players].sort((a, b) => b.name.length - a.name.length)
        .find((player) => text.startsWith(`${normalize(player.name)} `));
      const event = { key: `${identity}:roll`, persistent: Boolean(move), type: "roll", total: dice[0] + dice[1], faces: dice };
      if (roller) event.actor = roller.id;
      return event;
    }

    // Match whole known names instead of splitting at "de"/"from" inside a nickname.
    for (const actor of players) {
      const name = normalize(actor.name);
      if (!text.startsWith(`${name} `)) continue;
      const action = text.slice(name.length).trim();
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
          return {
            key: `${identity}:theft:${actor.id}:${victim.id}`,
            persistent: Boolean(move), type: "theft", actor: actor.id, victim: victim.id
          };
        }
      }
    }
    return null;
  }

  function validEvent(event) {
    return event && typeof event.key === "string" && typeof event.persistent === "boolean"
      && ((event.type === "roll" && Number.isInteger(event.total) && event.total >= 2 && event.total <= 12
        // Faces and roller are optional so data saved by older versions stays valid.
        && (event.faces === undefined || (Array.isArray(event.faces) && event.faces.length === 2
          && event.faces.every((face) => Number.isInteger(face) && face >= 1 && face <= 6)
          && event.faces[0] + event.faces[1] === event.total))
        && (event.actor === undefined || typeof event.actor === "string"))
        || (event.type === "theft" && typeof event.actor === "string"
          && typeof event.victim === "string" && event.actor !== event.victim));
  }

  function summarize(events, players) {
    const dice = Array(13).fill(0);
    const thefts = new Map(players.map((player) => [player.id, { ...player, made: 0, suffered: 0 }]));
    let rolls = 0;
    let robberies = 0;
    for (const event of events) {
      if (event.type === "roll") {
        dice[event.total] += 1;
        rolls += 1;
      } else {
        robberies += 1;
        if (thefts.has(event.actor)) thefts.get(event.actor).made += 1;
        if (thefts.has(event.victim)) thefts.get(event.victim).suffered += 1;
      }
    }
    return { dice, rolls, robberies, players: [...thefts.values()] };
  }

  // Oldest first, ordered by BGA move number; rolls without a move ID come last.
  function rollHistory(events) {
    const position = (event) => {
      const match = /^(move|log):(?:log_)?(\d+):/.exec(event.key);
      return match ? [match[1] === "move" ? 0 : 1, Number(match[2])] : [2, 0];
    };
    return [...events].filter((event) => event.type === "roll")
      .map((event) => ({ event, at: position(event) }))
      .sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1])
      .map(({ event }) => event);
  }

  const api = { isCatanUrl, readLog, validEvent, summarize, rollHistory };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CatanStats = api;
})(globalThis);
