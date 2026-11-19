(async function () {
  "use strict";

  const stats = globalThis.CatanStats;
  if (!stats.isCatanUrl(location.href) || document.getElementById("cbv-panel")) return;

  const table = new URL(location.href).searchParams.get("table");
  const storageKey = `catan-bga-viewer:v1:${table}`;
  const events = new Map();
  const tabNames = ["resources", "dice", "thefts", "costs"];
  const tabLabels = { costs: "Custos", dice: "Dados", thefts: "Roubos", resources: "Recursos" };
  const resourceLabels = { lumber: "Madeira", brick: "Tijolo", wool: "Lã", grain: "Trigo", ore: "Minério" };
  const playerPalette = {
    blue: "#246a9d", brown: "#78512d", green: "#3b7c3d", orange: "#a85d13",
    purple: "#7547a3", red: "#c0261b", white: "#626262", yellow: "#8a6a00"
  };
  // BGA terrain class suffix (cat_Forest, ...) -> resource it produces.
  const terrains = { Forest: "lumber", Hills: "brick", Pasture: "wool", Field: "grain", Fields: "grain", Mountain: "ore", Mountains: "ore" };
  let players = [];
  let panel;
  let summary;
  let area;
  let logs;
  let tab = "resources";
  const historyView = { resources: false, dice: false, thefts: false };
  let storageError = "";
  let rollbackWarning = "";
  let reloadMessage = "";
  let scanTimer;
  let saveTimer;
  let saving = false;
  let dirty = false;
  let lastRender = "";
  // First move of the uninterrupted log record used for the hand estimate, and the newest move seen.
  let handFrom;
  let lastSeenMove;
  let handReset = false;
  let handCheckpoint;
  let eventsVersion = 0;
  let handCache = { key: "", value: [] };

  function validCheckpoint(checkpoint) {
    return checkpoint && Number.isInteger(checkpoint.through) && checkpoint.through >= 0
      && Array.isArray(checkpoint.seen) && checkpoint.seen.every((key) => typeof key === "string")
      && checkpoint.hands && typeof checkpoint.hands === "object" && !Array.isArray(checkpoint.hands)
      && Object.values(checkpoint.hands).every((hand) => hand && Number.isInteger(hand.unknown) && hand.unknown >= 0
        && hand.resources && typeof hand.resources === "object" && !Array.isArray(hand.resources)
        && stats.resources.every((resource) => Number.isInteger(hand.resources[resource]) && hand.resources[resource] >= 0));
  }

  try {
    const saved = (await chrome.storage.local.get(storageKey))[storageKey];
    if (saved !== undefined) {
      if (!saved || saved.version !== 1 || !Array.isArray(saved.events)
        || !saved.events.every(stats.validEvent)
        || (saved.handCheckpoint !== undefined && !validCheckpoint(saved.handCheckpoint))) {
        throw new Error("Os dados salvos desta mesa possuem formato inválido.");
      }
      for (const event of saved.events) events.set(event.key, event);
      if (Number.isInteger(saved.handFrom)) handFrom = saved.handFrom;
      if (Number.isInteger(saved.lastSeenMove)) lastSeenMove = saved.lastSeenMove;
      handReset = saved.handReset === true;
      handCheckpoint = saved.handCheckpoint;
      eventsVersion += 1;
    }
  } catch (error) {
    reportStorageError(error);
  }

  function reportStorageError(error) {
    console.error("[Catan BGA Viewer] Falha no armazenamento local:", error);
    storageError = "Falha ao salvar/ler dados locais. O histórico pode ficar incompleto ao recarregar.";
    lastRender = "";
    render();
  }

  async function save() {
    dirty = true;
    if (saving) return;
    saving = true;
    try {
      while (dirty) {
        dirty = false;
        await chrome.storage.local.set({
          [storageKey]: {
            version: 1,
            events: [...events.values()].filter((event) => event.persistent),
            ...(handFrom === undefined ? {} : { handFrom, lastSeenMove }),
            ...(handReset ? { handReset: true } : {}),
            ...(handCheckpoint ? { handCheckpoint } : {})
          }
        });
      }
    } catch (error) {
      reportStorageError(error);
    } finally {
      saving = false;
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 150);
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function mount() {
    summary = document.getElementById("cat_summary");
    if (!summary || !document.getElementById("cat_map")) return false;
    area = summary.parentElement;
    panel = element("section", "", "");
    panel.id = "cbv-panel";
    panel.setAttribute("aria-label", "Custos e estatísticas de Catan");
    const tabs = element("div", "cbv-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Informações de Catan");
    for (const id of tabNames) {
      const label = tabLabels[id];
      const button = element("button", "", label);
      button.type = "button";
      button.id = `cbv-tab-${id}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", `cbv-${id}`);
      if (id === "costs") button.setAttribute("aria-label", "Custos de construção");
      button.addEventListener("click", () => selectTab(id));
      button.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = tabNames.indexOf(tab);
        const next = event.key === "Home" ? tabNames[0] : event.key === "End" ? tabNames[tabNames.length - 1]
          : tabNames[(index + (event.key === "ArrowRight" ? 1 : tabNames.length - 1)) % tabNames.length];
        selectTab(next);
        panel.querySelector(`#cbv-tab-${next}`).focus();
      });
      tabs.append(button);
    }
    panel.append(tabs);
    const content = element("div", "cbv-content");
    for (const id of tabNames) {
      const body = element("div", "cbv-body");
      body.id = `cbv-${id}`;
      body.setAttribute("role", "tabpanel");
      body.setAttribute("aria-labelledby", `cbv-tab-${id}`);
      content.append(body);
    }
    const status = element("div", "cbv-status");
    status.id = "cbv-status";
    status.setAttribute("role", "status");
    panel.append(content);
    const footer = element("div", "cbv-footer");
    const reload = element("button", "cbv-history-button cbv-reload", "\u21bb");
    reload.id = "cbv-reload";
    reload.type = "button";
    reload.title = "Reler e recalcular os logs carregados, preservando o histórico anterior";
    reload.setAttribute("aria-label", "Recalcular logs");
    reload.disabled = true;
    reload.addEventListener("click", () => {
      clearTimeout(scanTimer);
      scan({ recalculate: true });
    });
    footer.append(status, reload);
    panel.append(footer);
    // Keep the original node: BGA updates its resource checks and trade rates in place.
    summary.replaceWith(panel);
    panel.querySelector("#cbv-costs").append(summary);
    selectTab(tab);
    resizeObserver.observe(area);
    resizeObserver.observe(summary);
    return true;
  }

  function selectTab(id) {
    tab = id;
    for (const name of tabNames) {
      const selected = name === tab;
      const button = panel.querySelector(`#cbv-tab-${name}`);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      panel.querySelector(`#cbv-${name}`).hidden = !selected;
    }
    panel.querySelector("#cbv-status").style.visibility = tab === "costs" ? "hidden" : "";
    position();
  }

  function position() {
    if (!panel?.isConnected || !summary?.isConnected) return;
    const style = getComputedStyle(summary);
    panel.style.setProperty("--cbv-summary-width", style.width);
    panel.style.setProperty("--cbv-summary-height", style.height);
  }

  // Pip centers on a 3x3 grid (1 = left/top, 2 = middle, 3 = right/bottom).
  const pipLayout = {
    1: [[2, 2]],
    2: [[1, 1], [3, 3]],
    3: [[1, 1], [2, 2], [3, 3]],
    4: [[1, 1], [3, 1], [1, 3], [3, 3]],
    5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]],
    6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]]
  };
  const svgNs = "http://www.w3.org/2000/svg";

  // SVG keeps the pips crisp and centered at small sizes, unlike pixel-positioned CSS dots.
  function die(face) {
    const node = element("span", "cbv-die");
    if (!(face >= 1 && face <= 6)) {
      node.classList.add("cbv-die-unknown");
      node.textContent = "?";
      return node;
    }
    node.dataset.face = String(face);
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    const body = document.createElementNS(svgNs, "rect");
    for (const [key, value] of Object.entries({ x: 0.5, y: 0.5, width: 15, height: 15, rx: 3, fill: "#fff", stroke: "#222", "stroke-width": 1 })) {
      body.setAttribute(key, value);
    }
    svg.append(body);
    for (const [column, row] of pipLayout[face]) {
      const pip = document.createElementNS(svgNs, "circle");
      pip.setAttribute("class", "cbv-pip");
      pip.setAttribute("cx", String(column * 4));
      pip.setAttribute("cy", String(row * 4));
      pip.setAttribute("r", "1.6");
      pip.setAttribute("fill", "#111");
      svg.append(pip);
    }
    node.append(svg);
    return node;
  }

  function renderRollHistory(rolls) {
    const playersById = new Map(players.map((player) => [player.id, player]));
    const list = element("ol", "cbv-history");
    list.id = "cbv-roll-history";
    if (!rolls.length) list.append(element("li", "cbv-event-empty", "Nenhuma rolagem ainda."));
    for (let index = rolls.length - 1; index >= 0; index -= 1) {
      const roll = rolls[index];
      const player = playersById.get(roll.actor);
      const name = player?.name || "—";
      const item = element("li", `cbv-roll${index === rolls.length - 1 ? " cbv-latest" : ""}`);
      item.title = `Rolagem ${index + 1}: ${name} tirou ${roll.faces ? roll.faces.join(" + ") + " = " : ""}${roll.total}`;
      item.setAttribute("aria-label", item.title);
      const dice = element("span", "cbv-dice-pair");
      dice.append(die(roll.faces?.[0]), die(roll.faces?.[1]));
      item.append(
        element("span", "cbv-roll-index", String(index + 1)),
        playerNameNode(roll.actor, name, "cbv-roll-name"),
        dice,
        element("span", `cbv-sum${roll.total === 7 ? " cbv-seven" : ""}`, String(roll.total))
      );
      list.append(item);
    }
    return list;
  }

  function historySwitch(key, summaryHeading, summaryContent, historyTitle, historyContent) {
    const view = element("div", `cbv-history-view cbv-${key}-view`);
    const header = element("div", "cbv-view-header");
    const button = element("button", "cbv-history-button");
    button.type = "button";
    button.id = `cbv-${key}-history-button`;
    button.setAttribute("aria-controls", `cbv-${key}-history-content`);
    const content = element("div", "cbv-history-content");
    content.id = `cbv-${key}-history-content`;
    const summaryTitle = summaryHeading.textContent;
    const summaryTooltip = summaryHeading.title;
    const update = () => {
      const showingHistory = historyView[key];
      view.classList.toggle("cbv-showing-history", showingHistory);
      button.textContent = showingHistory ? "Voltar" : "Histórico";
      button.setAttribute("aria-expanded", String(showingHistory));
      summaryHeading.textContent = showingHistory ? historyTitle : summaryTitle;
      summaryHeading.title = showingHistory ? "" : summaryTooltip;
      content.replaceChildren(showingHistory ? historyContent : summaryContent);
    };
    button.addEventListener("click", () => {
      historyView[key] = !historyView[key];
      update();
    });
    header.append(summaryHeading, button);
    view.append(header, content);
    update();
    return view;
  }

  function historyList(id, entries, describe, emptyMessage) {
    const list = element("ol", "cbv-event-history");
    list.id = id;
    if (!entries.length) {
      list.append(element("li", "cbv-event-empty", emptyMessage));
      return list;
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const item = element("li", `cbv-event${index === entries.length - 1 ? " cbv-latest" : ""}`);
      const description = describe(entries[index]);
      if (typeof description === "string") item.textContent = description;
      else item.append(description);
      item.title = item.textContent;
      list.append(item);
    }
    return list;
  }

  function moveId(event) {
    return /^move:(\d+):/.exec(event.key)?.[1];
  }

  function renderTheftHistory(thefts, resourceEvents) {
    const theftsByMove = new Map();
    for (const event of thefts) {
      const move = moveId(event);
      if (!move) continue;
      if (!theftsByMove.has(move)) theftsByMove.set(move, []);
      theftsByMove.get(move).push(event);
    }
    const revealedResources = new Map();
    for (const event of resourceEvents) {
      if (event.type !== "reveal") continue;
      const move = moveId(event);
      const matchingThefts = theftsByMove.get(move);
      const revealed = Object.entries(event.resources).filter(([, amount]) => amount > 0);
      const total = revealed.reduce((sum, [, amount]) => sum + amount, 0);
      if (move && matchingThefts?.length === 1 && revealed.length === 1 && total === 1 && !revealedResources.has(move)) {
        revealedResources.set(move, revealed[0][0]);
      }
    }
    return historyList("cbv-theft-history", thefts, (event) => {
      const description = element("span", "cbv-history-line");
      description.append(
        playerNameNode(event.actor, "Jogador", "cbv-player-name"),
        document.createTextNode(" roubou de "),
        playerNameNode(event.victim, "jogador", "cbv-player-name")
      );
      const resource = revealedResources.get(moveId(event));
      if (resource) {
        description.append(document.createTextNode(": 1 "), resourceIcon(resource));
      } else {
        description.append(document.createTextNode("."));
      }
      return description;
    }, "Nenhum roubo registrado.");
  }

  function appendDeltas(container, amounts, direction) {
    const changed = stats.resources.filter((resource) => amounts[resource] > 0);
    changed.forEach((resource, index) => {
      if (index) container.append(document.createTextNode(" e "));
      const sign = direction === "gain" ? "+" : "-";
      const delta = element("span", `cbv-resource-delta cbv-resource-${direction}`, `${sign}${amounts[resource]}`);
      delta.append(resourceIcon(resource));
      container.append(delta);
    });
  }

  function describeResourceEvent(event) {
    const description = element("span", "cbv-history-line");
    const actor = playerNameNode(event.actor, "Jogador", "cbv-player-name");
    if (event.type === "gain") {
      description.append(actor, document.createTextNode(" recebe "));
      appendDeltas(description, event.resources, "gain");
    } else if (event.type === "spend") {
      const action = event.category === "build" ? event.label || "construiu"
        : event.category === "development" ? "comprou carta de desenvolvimento"
          : event.category === "discard" ? "descartou"
            : event.category === "loss" ? "perdeu" : "usou";
      description.append(actor, document.createTextNode(` ${action}: `));
      appendDeltas(description, event.resources, "loss");
    } else if (event.type === "trade") {
      if (event.partner) {
        description.append(
          actor,
          document.createTextNode(" trocou com "),
          playerNameNode(event.partner, "jogador", "cbv-player-name"),
          document.createTextNode(": ")
        );
      } else {
        description.append(actor, document.createTextNode(" trocou com o banco: "));
      }
      appendDeltas(description, event.gives, "loss");
      description.append(document.createTextNode(" e "));
      appendDeltas(description, event.gets, "gain");
      if (event.partner) {
        description.append(
          document.createTextNode("; "),
          playerNameNode(event.partner, "jogador", "cbv-player-name"),
          document.createTextNode(": ")
        );
        appendDeltas(description, event.gets, "loss");
        description.append(document.createTextNode(" e "));
        appendDeltas(description, event.gives, "gain");
      }
    } else {
      description.append(document.createTextNode(`Roubo revelado: você ${event.direction === "gain" ? "recebe" : "perde"} `));
      appendDeltas(description, event.resources, event.direction);
    }
    return description;
  }

  function renderResourceHistory(events) {
    return historyList("cbv-resource-history", events, describeResourceEvent, "Nenhuma movimentação de recursos registrada.");
  }

  function playerNameNode(id, fallback, className) {
    const player = players.find((candidate) => candidate.id === id);
    const name = element("span", className, player?.name || fallback);
    if (player?.color) name.style.color = player.color;
    return name;
  }

  function playerColor(id) {
    const board = document.getElementById(`overall_player_board_${id}`);
    const marker = board?.querySelector('[class*="cat_color_"]');
    const token = [...(marker?.classList || [])].map((name) => /^cat_color_(.+)$/.exec(name)?.[1]).find(Boolean);
    if (!token) return "";
    if (/^[\da-f]{6}$/i.test(token)) return `#${token}`;
    return playerPalette[token.toLowerCase()] || "";
  }

  function resourceIcon(resource) {
    const icon = element("span", `cbv-res cat_log_token icon_${resource}`);
    const sprite = readResourceSprite();
    if (sprite) icon.style.backgroundImage = sprite;
    else {
      icon.classList.add("cbv-res-text");
      icon.textContent = resourceLabels[resource].slice(0, 2);
    }
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", resourceLabels[resource]);
    icon.title = resourceLabels[resource];
    return icon;
  }

  function readBoard() {
    const center = (node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, radius: rect.height / 2 };
    };
    const robberHex = document.getElementById("cat_robber")?.closest(".cat_hex");
    const hexes = [...document.querySelectorAll('#cat_map .cat_hex[id^="cathex_"]')].map((hex) => {
      const terrain = [...hex.classList].map((name) => /^cat_([A-Z]\w*)$/.exec(name)?.[1]).find((name) => terrains[name]);
      const number = [...(hex.querySelector(".cat_num_token")?.classList || [])]
        .map((name) => /^cat_num_(\d+)$/.exec(name)).find(Boolean);
      return { ...center(hex), resource: terrains[terrain] || null, number: number ? Number(number[1]) : null, robber: hex === robberHex };
    });
    const owners = new Map();
    for (const player of players) {
      const board = document.getElementById(`overall_player_board_${player.id}`);
      const color = [...(board?.querySelector('[class*="cat_color_"]')?.classList || [])].find((name) => name.startsWith("cat_color_"));
      if (color) owners.set(color, player.id);
    }
    const buildings = [];
    for (const building of document.querySelectorAll("#cat_map .cat_building")) {
      const level = building.classList.contains("cat_town") ? 2 : building.classList.contains("cat_settlement") ? 1 : 0;
      const owner = owners.get([...building.classList].find((name) => name.startsWith("cat_color_")));
      // The vertex slot is centered on the hex corner; the building image itself is not.
      if (level && owner) buildings.push({ ...center(building.closest(".cat_place_living") || building), owner, level });
    }
    return { hexes, buildings, visible: hexes.some((hex) => hex.radius > 0) };
  }

  // BGA scopes the sprite image to its own containers, so borrow it from a resource icon in the
  // cost box (always present) or in the log. Dice tokens share cat_log_token but use another sprite.
  let resourceSprite = "";
  function readResourceSprite() {
    if (resourceSprite) return resourceSprite;
    const selector = stats.resources.flatMap((resource) =>
      [`#cat_summary .icon_${resource}`, `#logs .cat_log_token.icon_${resource}`]).join(",");
    for (const icon of document.querySelectorAll(selector)) {
      const image = getComputedStyle(icon).backgroundImage;
      if (image && image !== "none") return (resourceSprite = image);
    }
    return "";
  }

  // after: extra columns after the resources, each { head, title, cell(row, sum) -> { text, className, title } }.
  function resourceTable(rows, { value, describe, robbed = () => 0, uncertain = () => false, after }) {
    const sprite = readResourceSprite();
    const columns = after || [{
      head: "Σ", title: "Total",
      cell: (row, sum) => ({ text: String(sum), className: "cbv-sum-col", title: `${row.name} · total: ${describe(row, null, sum)}` })
    }];
    const tableNode = element("table", "cbv-table cbv-resources");
    const headRow = element("tr");
    const corner = element("th", "", "Jogador");
    corner.scope = "col";
    headRow.append(corner);
    for (const resource of stats.resources) {
      const cell = element("th");
      cell.scope = "col";
      cell.title = resourceLabels[resource];
      const icon = element("span", `cbv-res cat_log_token icon_${resource}`);
      if (sprite) icon.style.backgroundImage = sprite;
      else {
        icon.classList.add("cbv-res-text");
        icon.textContent = resourceLabels[resource].slice(0, 2);
      }
      icon.setAttribute("role", "img");
      icon.setAttribute("aria-label", resourceLabels[resource]);
      cell.append(icon);
      headRow.append(cell);
    }
    for (const column of columns) {
      const cell = element("th", "", column.head);
      cell.scope = "col";
      cell.title = column.title;
      headRow.append(cell);
    }
    const head = element("thead");
    head.append(headRow);
    const body = element("tbody");
    for (const row of rows) {
      const line = element("tr");
      const name = element("th", "cbv-name", row.name);
      name.scope = "row";
      name.title = row.name;
      if (row.color) name.style.color = row.color;
      line.append(name);
      let sum = 0;
      for (const resource of stats.resources) {
        const amount = value(row, resource);
        const blocked = robbed(row, resource);
        sum += amount;
        const classes = [blocked ? "cbv-robbed" : amount ? "" : "cbv-muted", uncertain(row, resource) ? "cbv-uncertain" : ""];
        const cell = element("td", classes.filter(Boolean).join(" "), String(amount));
        cell.title = `${row.name} · ${resourceLabels[resource]}: ${describe(row, resource, amount)}${blocked ? ` · ladrão bloqueia ${blocked}` : ""}`;
        line.append(cell);
      }
      for (const column of columns) {
        const { text, className = "", title = "" } = column.cell(row, sum);
        const cell = element("td", className, text);
        if (title) cell.title = title;
        line.append(cell);
      }
      body.append(line);
    }
    tableNode.append(head, body);
    return tableNode;
  }

  const cards = (value) => `${value} carta${value === 1 ? "" : "s"}`;

  function handTable(hands) {
    const columns = [{
      head: "?", title: "Cartas cujo recurso não pode ser garantido; restante após os mínimos de cada recurso",
      cell: (hand) => ({
        text: String(hand.unassigned), className: hand.unassigned ? "cbv-uncertain" : "cbv-muted",
        title: `${hand.name} · ${cards(hand.unassigned)} sem recurso garantido`
      })
    }, {
      head: "Σ", title: "Total de cartas na mão",
      cell: (hand) => ({
        text: `${hand.total}${hand.consistent ? "" : "*"}`, className: "cbv-sum-col",
        title: hand.consistent ? `${hand.name} · ${cards(hand.total)}`
          : `${hand.name} · ${cards(hand.total)} pelos logs, mas a BGA mostra ${hand.bga}: aguardando sincronização`
      })
    }];
    return resourceTable(hands, {
      value: (hand, resource) => hand.hand[resource],
      describe: (hand, resource, amount) => {
        const [min, max] = hand.range[resource];
        const spread = min === max ? "" : `; pode chegar a ${max} (média ${hand.expected[resource].toFixed(1)})`;
        return `${cards(amount)} garantidas${spread}`;
      },
      uncertain: (hand, resource) => hand.range[resource][0] !== hand.range[resource][1],
      after: columns
    });
  }

  function renderResources(summary, board, potential, hands, resourceEvents) {
    const node = panel.querySelector("#cbv-resources");
    const summaryView = element("div", "cbv-resource-summary");
    const held = hands.reduce((sum, hand) => sum + hand.total, 0);
    const heading = element("div", "cbv-total", `Mão estimada · ${cards(held)}`);
    heading.title = "Palpite pelos logs: produção, trocas, construções, descartes e roubos. A carta roubada não aparece para quem assiste.";
    summaryView.append(handTable(hands));
    const legend = ["Destaque = pode haver mais desse recurso"];
    legend.push("? = cartas sem recurso garantido (0 quando nenhuma)");
    if (hands.some((hand) => !hand.consistent)) legend.push("* = difere da BGA");
    summaryView.append(element("div", "cbv-note", `${legend.join(" · ")}.`));

    const potentialHeading = element("div", "cbv-total cbv-subtitle", "Potencial no tabuleiro · pontos");
    potentialHeading.title = "Chances em 36 rolagens de cada número tocado pelas aldeias (×1) e cidades (×2).";
    summaryView.append(potentialHeading);
    if (!board.visible) summaryView.append(element("div", "cbv-note", "Tabuleiro não encontrado."));
    else {
      summaryView.append(resourceTable(potential, {
        value: (player, resource) => player.pips[resource],
        describe: (player, resource, value) => `${value}/36 ≈ ${(value / 36).toFixed(2)} carta${value === 1 ? "" : "s"} por rolagem`,
        robbed: (player, resource) => player.robbed[resource]
      }));
      const robbed = potential.some((player) => stats.resources.some((resource) => player.robbed[resource]));
      summaryView.append(element("div", "cbv-note", `Pontos = chances em 36 rolagens (cidade conta 2).${robbed ? " Em vermelho: sob o ladrão." : ""}`));
    }

    const produced = summary.players.reduce((sum, player) =>
      sum + stats.resources.reduce((total, resource) => total + player.gains[resource], 0), 0);
    summaryView.append(
      element("div", "cbv-total cbv-subtitle", `Produção recebida · ${cards(produced)}`),
      resourceTable(summary.players, { value: (player, resource) => player.gains[resource], describe: (player, resource, value) => cards(value) })
    );
    node.replaceChildren(historySwitch("resources", heading, summaryView, "Histórico de recursos",
      renderResourceHistory(resourceEvents)));
  }

  function logsLoading() {
    const mask = document.getElementById("loader_mask");
    return mask && mask.getClientRects().length > 0 && getComputedStyle(mask).visibility !== "hidden";
  }

  // Exact card counts BGA shows on each player panel (public information).
  function readHandTotals() {
    const totals = {};
    for (const player of players) {
      const text = document.getElementById(`cat_panel_score_resources_${player.id}`)?.textContent.trim();
      if (text && /^\d+$/.test(text)) totals[player.id] = Number(text);
    }
    return totals;
  }

  // Panel counters can lag the logs until BGA's animation completes.
  const SETTLE_MS = 4000;
  let settled = { from: undefined, start: null };
  let mismatchSince;
  let mismatchKey = "";
  const warnedMismatch = new Set();
  let settleTimer;

  function resetMismatchTimer() {
    mismatchSince = undefined;
    mismatchKey = "";
    clearTimeout(settleTimer);
  }

  function estimateHands() {
    const totals = readHandTotals();
    const from = handFrom ?? Infinity;
    const estimate = (options) => {
      const key = JSON.stringify([eventsVersion, handCheckpoint, options, players]);
      if (handCache.key !== key) {
        let recorded = events.values();
        if (handCheckpoint) {
          const seen = new Set(handCheckpoint.seen);
          // A move may gain new log lines after the checkpoint was taken.
          recorded = [...recorded].filter((event) => {
            const move = moveId(event);
            return move ? Number(move) > handCheckpoint.through
              || (Number(move) === handCheckpoint.through && !seen.has(event.key)) : !seen.has(event.key);
          });
        }
        handCache = { key, value: stats.handEstimate(recorded, players, options) };
      }
      return handCache.value;
    };
    let value;
    let firstEstimate = false;
    if (handCheckpoint) value = estimate({ initialHands: handCheckpoint.hands });
    else if (settled.start && settled.from === handFrom) value = estimate({ from, start: settled.start });
    else {
      value = estimate({ from, totals });
      settled = { from: handFrom, start: Object.fromEntries(value.map((hand) => [hand.id, hand.initial])) };
      firstEstimate = true;
    }

    const differs = (hand) => Number.isInteger(totals[hand.id]) && totals[hand.id] !== hand.total;
    const mismatches = new Set(value.filter(differs).map((hand) => hand.id));
    for (const id of warnedMismatch) if (!mismatches.has(id)) warnedMismatch.delete(id);
    // Keep an initial warning steady; later differences get a grace period for animations.
    if (firstEstimate) for (const id of mismatches) warnedMismatch.add(id);

    if (!mismatches.size || document.hidden) resetMismatchTimer();
    else {
      const key = JSON.stringify([eventsVersion, handFrom, totals, players.map((player) => player.id)]);
      const now = performance.now();
      if (key !== mismatchKey) {
        mismatchKey = key;
        mismatchSince = now;
      }
      const elapsed = now - mismatchSince;
      if (elapsed < SETTLE_MS || scanTimer !== undefined) {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(render, scanTimer === undefined ? SETTLE_MS - elapsed + 50 : 150);
      } else {
        const reconstructed = handCheckpoint ? null : estimate({ from, totals });
        if (reconstructed && reconstructed.every((hand) => !differs(hand))) {
          value = reconstructed;
          settled = { from: handFrom, start: Object.fromEntries(value.map((hand) => [hand.id, hand.initial])) };
        } else {
          const hands = Object.fromEntries(value.map((hand) => [hand.id, differs(hand)
            ? { resources: Object.fromEntries(stats.resources.map((resource) => [resource, 0])), unknown: totals[hand.id] }
            : { resources: hand.hand, unknown: hand.unassigned }]));
          const through = lastSeenMove ?? 0;
          const seen = [...events.values()].filter((event) => {
            const move = moveId(event);
            return !move || Number(move) === through;
          }).map((event) => event.key);
          handCheckpoint = { through, seen, hands };
          value = stats.handEstimate([], players, { initialHands: hands });
          scheduleSave();
        }
        warnedMismatch.clear();
        resetMismatchTimer();
      }
    }
    return value.map((hand) => ({ ...hand, bga: totals[hand.id], consistent: !warnedMismatch.has(hand.id) }));
  }

  function render() {
    if (!panel) return;
    if (logsLoading()) {
      resetMismatchTimer();
      lastRender = "";
      const status = panel.querySelector("#cbv-status");
      status.textContent = storageError || "Aguardando a BGA carregar os últimos movimentos...";
      status.classList.toggle("cbv-error", Boolean(storageError));
      panel.querySelector("#cbv-reload").disabled = true;
      // The loader may disappear through a style change, which the log observer does not watch.
      if (scanTimer === undefined) scanTimer = setTimeout(scan, 150);
      return;
    }
    const summary = stats.summarize(events.values(), players);
    const rolls = stats.rollHistory(events.values());
    const theftHistory = stats.theftHistory(events.values());
    const resourceEvents = stats.resourceHistory(events.values());
    const board = readBoard();
    const potential = stats.potential(board, players);
    const hands = estimateHands();
    const signature = JSON.stringify([summary, rolls, theftHistory, resourceEvents, potential, hands, board.visible, storageError,
      rollbackWarning, reloadMessage, handReset, Boolean(handCheckpoint), Boolean(logs), readResourceSprite()]);
    panel.querySelector("#cbv-reload").disabled = !logs?.querySelector(".log[id]");
    if (signature === lastRender) return;
    lastRender = signature;
    renderResources(summary, board, potential, hands, resourceEvents);
    const dice = panel.querySelector("#cbv-dice");
    const diceSummary = element("div", "cbv-dice-summary");
    const diceHeading = element("div", "cbv-total", `${summary.rolls} rolagens contabilizadas`);
    const chart = element("div", "cbv-chart");
    const max = Math.max(1, ...summary.dice);
    for (let total = 2; total <= 12; total += 1) {
      const count = summary.dice[total];
      const percent = summary.rolls ? (count / summary.rolls * 100).toFixed(1) : "0.0";
      const row = element("div", "cbv-row");
      row.title = `Soma ${total}: ${count} (${percent}%)`;
      row.setAttribute("aria-label", row.title);
      const track = element("div", "cbv-track");
      const bar = element("div", `cbv-bar${total === 7 ? " cbv-seven" : ""}${count ? "" : " cbv-zero"}`);
      bar.style.setProperty("--cbv-ratio", String(count / max));
      bar.append(element("span", "cbv-count", String(count)));
      track.append(bar);
      row.append(element("span", "cbv-face", String(total)), track);
      chart.append(row);
    }
    diceSummary.append(chart);
    dice.replaceChildren(historySwitch("dice", diceHeading, diceSummary, "Histórico de rolagens",
      renderRollHistory(rolls)));

    const thefts = panel.querySelector("#cbv-thefts");
    const theftSummary = element("div", "cbv-theft-summary");
    const theftHeading = element("div", "cbv-total", `${summary.robberies} roubos · 7 e cavaleiro`);
    const tableNode = element("table", "cbv-table");
    const head = element("thead");
    const headRow = element("tr");
    for (const label of ["Jogador", "Feitos", "Sofridos"]) {
      const cell = element("th", "", label);
      cell.scope = "col";
      headRow.append(cell);
    }
    head.append(headRow);
    const body = element("tbody");
    for (const player of summary.players) {
      const row = element("tr");
      const name = element("th", "cbv-name", player.name);
      name.scope = "row";
      name.title = player.name;
      if (player.color) name.style.color = player.color;
      row.append(name, element("td", "", String(player.made)), element("td", "", String(player.suffered)));
      body.append(row);
    }
    tableNode.append(head, body);
    theftSummary.append(tableNode);
    thefts.replaceChildren(historySwitch("thefts", theftHeading, theftSummary, "Histórico de roubos",
      renderTheftHistory(theftHistory, resourceEvents)));
    const status = panel.querySelector("#cbv-status");
    status.textContent = storageError || rollbackWarning || (handReset
      ? "Estimativa reiniciada após retrocesso: o cache antigo não identificava quais ações eram reversíveis."
      : handCheckpoint ? "Mão sincronizada com a BGA após divergência; cartas sem identificação aparecem em ?."
      : !logs ? "Aguardando os logs da mesa..."
      : reloadMessage || "Histórico lido + salvo nesta mesa. Logs antigos não carregados podem faltar.");
    status.classList.toggle("cbv-error", Boolean(storageError || rollbackWarning || handReset));
    position();
  }

  function scan({ recalculate = false } = {}) {
    scanTimer = undefined;
    if (!panel?.isConnected) {
      if (!mount()) return;
      lastRender = "";
    }
    if (logsLoading()) {
      render();
      return;
    }
    players = [...document.querySelectorAll('[id^="player_name_"]')].map((node) => {
      const id = node.id.slice("player_name_".length);
      return {
        id,
        name: (node.querySelector("a") || node).textContent.replace(/\s+/g, " ").trim(),
        color: playerColor(id)
      };
    }).filter((player) => player.name);
    logs = document.getElementById("logs");
    const nodes = [...(logs?.querySelectorAll(".log[id]") || [])];
    const entries = nodes.map((log, index) => ({
      id: Number(/(\d+)$/.exec(log.id)?.[1] || 0),
      move: Number(log.getAttribute("data-move-id")),
      event: stats.readLog(log, players),
      setupActor: stats.readSetupActor(log, players),
      index
    })).sort((a, b) => a.id - b.id || a.index - b.index);
    const hasMove = (entry) => Number.isInteger(entry.move) && entry.move > 0;
    let changed = false;
    for (const entry of entries) {
      if (entry.event?.type !== "gain" || !hasMove(entry)) continue;
      // Initial settlement resources are undone with the placement; dice production is not.
      entry.event.reversible = entries.some((placement) => placement.move === entry.move
        && placement.id < entry.id && placement.setupActor === entry.event.actor)
        || events.get(entry.event.key)?.reversible === true;
    }
    for (const [position, entry] of entries.entries()) {
      if (entry.event?.type !== "reveal" || hasMove(entry)
        || Object.values(entry.event.resources).reduce((sum, amount) => sum + amount, 0) !== 1) continue;
      const candidates = [];
      // Replayed private notes can precede or follow the public theft and omit data-move-id.
      for (const direction of [-1, 1]) {
        const interveningMoves = [];
        for (let cursor = position + direction; cursor >= 0 && cursor < entries.length; cursor += direction) {
          const neighbor = entries[cursor];
          if (neighbor.event && neighbor.event.type !== "reveal") {
            if (neighbor.event.type === "theft" && hasMove(neighbor)
              && interveningMoves.every((move) => move === neighbor.move)) candidates.push(neighbor);
            break;
          }
          if (hasMove(neighbor)) interveningMoves.push(neighbor.move);
        }
      }
      if (candidates.length !== 1) continue;
      if (events.delete(entry.event.key)) changed = true;
      entry.move = candidates[0].move;
      entry.event.key = entry.event.key.replace(/^log:[^:]+:/, `move:${entry.move}:`);
      entry.event.persistent = true;
    }
    if (recalculate && entries.length) {
      const moves = entries.filter(hasMove).map((entry) => entry.move);
      const first = Math.min(...moves);
      const last = Math.max(...moves);
      // Replace only the loaded interval; older cached logs may no longer be in the DOM.
      for (const [key, event] of events) {
        const move = moveId(event);
        if (!move || Number(move) >= first && Number(move) <= last) events.delete(key);
      }
      handCheckpoint = undefined;
      settled = { from: undefined, start: null };
      handCache = { key: "", value: [] };
      handReset = false;
      rollbackWarning = "";
      warnedMismatch.clear();
      resetMismatchTimer();
      reloadMessage = "Logs carregados recalculados. Histórico anterior preservado.";
      changed = true;
    }
    let active = [];
    const cancelled = new Set();
    for (const entry of entries) {
      if (entry.event?.type === "rollback") {
        if (!hasMove(entry)) {
          if (!rollbackWarning) {
            rollbackWarning = "Jogada desfeita sem identificação: as estatísticas podem estar incorretas.";
            console.warn("[Catan BGA Viewer]", rollbackWarning);
          }
        } else {
          // Undo reuses the first reverted move ID, while the old logs can remain on screen.
          active = active.filter((previous) => {
            const removed = hasMove(previous) && previous.move >= entry.move
              && previous.event?.reversible === true && previous.event.actor === entry.event.actor;
            if (removed && previous.event) cancelled.add(previous.event.key);
            return !removed;
          });
        }
      }
      active.push(entry);
    }

    const newRollbacks = active.filter((entry) => entry.event?.type === "rollback"
      && hasMove(entry) && !events.has(entry.event.key));
    if (newRollbacks.length) {
      const cutoff = Math.min(...newRollbacks.map((entry) => entry.move));
      if (handCheckpoint && cutoff <= handCheckpoint.through) {
        handCheckpoint = undefined;
        settled = { from: undefined, start: null };
        changed = true;
      }
      const activeEvents = new Map(active.filter((entry) => entry.event).map((entry) => [entry.event.key, entry.event]));
      let ambiguousLegacyEvent = false;
      for (const key of events.keys()) {
        const move = /^move:(\d+):/.exec(key);
        if (!move || Number(move[1]) < cutoff) continue;
        const event = events.get(key);
        const current = activeEvents.get(key);
        const resolved = current || event;
        const affected = newRollbacks.some((rollback) => Number(move[1]) >= rollback.move
          && rollback.event.actor === resolved.actor);
        if (cancelled.has(key) || !current && event.reversible === true && affected) {
          if (events.delete(key)) changed = true;
          continue;
        }
        if (!current && event.reversible === undefined
          && (event.type === "spend" || event.type === "trade") && affected) {
          ambiguousLegacyEvent = true;
          if (events.delete(key)) changed = true;
        }
      }
      if (lastSeenMove !== undefined && lastSeenMove >= cutoff) {
        lastSeenMove = cutoff - 1;
        changed = true;
      }
      if (handFrom !== undefined && handFrom >= cutoff) {
        handFrom = undefined;
        settled = { from: undefined, start: null };
        changed = true;
      }
      if (ambiguousLegacyEvent) {
        const currentMax = Math.max(0, ...active.map((entry) => hasMove(entry) ? entry.move : 0));
        handFrom = currentMax + 1;
        lastSeenMove = currentMax;
        handReset = true;
        handCheckpoint = undefined;
        settled = { from: undefined, start: null };
        changed = true;
      }
    }
    const activeKeys = new Set(active.filter((entry) => entry.event).map((entry) => entry.event.key));
    for (const key of cancelled) {
      if (!activeKeys.has(key) && events.delete(key)) {
        changed = true;
        if (handCheckpoint && Number(moveId({ key })) <= handCheckpoint.through) {
          handCheckpoint = undefined;
          settled = { from: undefined, start: null };
        }
      }
    }

    // A move can produce several logs (build + gain, robber + theft); their numeric IDs grow over time.
    const order = new Map();
    const moves = [];
    for (const entry of active) {
      if (!hasMove(entry)) continue;
      moves.push(entry.move);
      if (!order.has(entry.move)) order.set(entry.move, []);
      order.get(entry.move).push(entry.id);
    }
    for (const list of order.values()) list.sort((a, b) => a - b);
    for (const entry of active) {
      const event = entry.event;
      if (!event) continue;
      const sameMove = order.get(entry.move);
      const seq = sameMove ? sameMove.indexOf(entry.id) : 0;
      if (seq > 0) event.seq = seq;
      const previous = events.get(event.key);
      if (previous && JSON.stringify(previous) === JSON.stringify(event)) continue;
      events.set(event.key, event);
      changed = true;
    }
    if (moves.length) {
      const domMin = Math.min(...moves);
      const domMax = Math.max(...moves);
      // Moves missing between the last visit and the oldest log now loaded: restart the record.
      const restarted = handFrom === undefined || lastSeenMove === undefined || domMin > lastSeenMove + 1;
      if (restarted && handCheckpoint) {
        handCheckpoint = undefined;
        settled = { from: undefined, start: null };
        changed = true;
      }
      const from = restarted ? domMin : handReset ? handFrom : Math.min(handFrom, domMin);
      const seen = Math.max(lastSeenMove ?? domMax, domMax);
      if (from !== handFrom || seen !== lastSeenMove) {
        handFrom = from;
        lastSeenMove = seen;
        if (restarted) handReset = false;
        changed = true;
      }
    }
    if (changed) {
      eventsVersion += 1;
      scheduleSave();
    }
    render();
  }

  function scheduleScan(records) {
    if (records.every((record) => panel?.contains(record.target))) return;
    if (scanTimer === undefined) scanTimer = setTimeout(scan, 80);
  }

  const resizeObserver = new ResizeObserver(position);
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.addEventListener("resize", position);
  document.addEventListener("visibilitychange", () => {
    resetMismatchTimer();
    if (document.hidden) return;
    // Queued BGA animations (and their panel updates) only run again from now on.
    render();
  });
  window.addEventListener("pagehide", () => {
    clearTimeout(saveTimer);
    void save();
  });
  scan();
})();
