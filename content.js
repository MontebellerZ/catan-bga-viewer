(async function () {
  "use strict";

  const stats = globalThis.CatanStats;
  if (!stats.isCatanUrl(location.href) || document.getElementById("cbv-panel")) return;

  const table = new URL(location.href).searchParams.get("table");
  const storageKey = `catan-bga-viewer:v1:${table}`;
  const events = new Map();
  const tabNames = ["costs", "dice", "history", "thefts"];
  const tabLabels = { costs: "Custos", dice: "Dados", history: "Histórico", thefts: "Roubos" };
  let players = [];
  let panel;
  let summary;
  let area;
  let logs;
  let tab = "costs";
  let storageError = "";
  let scanTimer;
  let saveTimer;
  let saving = false;
  let dirty = false;
  let lastRender = "";

  try {
    const saved = (await chrome.storage.local.get(storageKey))[storageKey];
    if (saved !== undefined) {
      if (!saved || saved.version !== 1 || !Array.isArray(saved.events)
        || !saved.events.every(stats.validEvent)) {
        throw new Error("Os dados salvos desta mesa possuem formato inválido.");
      }
      for (const event of saved.events) events.set(event.key, event);
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
            events: [...events.values()].filter((event) => event.persistent)
          }
        });
      }
    } catch (error) {
      reportStorageError(error);
    } finally {
      saving = false;
    }
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
        const next = event.key === "Home" ? "costs" : event.key === "End" ? "thefts"
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
    content.append(status);
    panel.append(content);
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
    panel.querySelector("#cbv-status").hidden = tab === "costs";
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

  function renderHistory(rolls) {
    const history = panel.querySelector("#cbv-history");
    const names = new Map(players.map((player) => [player.id, player.name]));
    history.replaceChildren(element("div", "cbv-total", rolls.length ? "Mais recente primeiro" : "Nenhuma rolagem ainda"));
    const list = element("ol", "cbv-history");
    for (let index = rolls.length - 1; index >= 0; index -= 1) {
      const roll = rolls[index];
      const name = names.get(roll.actor) || "—";
      const item = element("li", `cbv-roll${index === rolls.length - 1 ? " cbv-latest" : ""}`);
      item.title = `Rolagem ${index + 1}: ${name} tirou ${roll.faces ? roll.faces.join(" + ") + " = " : ""}${roll.total}`;
      item.setAttribute("aria-label", item.title);
      const dice = element("span", "cbv-dice-pair");
      dice.append(die(roll.faces?.[0]), die(roll.faces?.[1]));
      item.append(
        element("span", "cbv-roll-index", String(index + 1)),
        element("span", "cbv-roll-name", name),
        dice,
        element("span", `cbv-sum${roll.total === 7 ? " cbv-seven" : ""}`, String(roll.total))
      );
      list.append(item);
    }
    history.append(list);
  }

  function render() {
    if (!panel) return;
    const summary = stats.summarize(events.values(), players);
    const rolls = stats.rollHistory(events.values());
    const signature = JSON.stringify([summary, rolls, storageError, Boolean(logs)]);
    if (signature === lastRender) return;
    lastRender = signature;
    renderHistory(rolls);
    const dice = panel.querySelector("#cbv-dice");
    dice.replaceChildren(element("div", "cbv-total", `${summary.rolls} rolagens contabilizadas`));
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
    dice.append(chart);

    const thefts = panel.querySelector("#cbv-thefts");
    thefts.replaceChildren(element("div", "cbv-total", `${summary.robberies} roubos · 7 e cavaleiro`));
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
      row.append(name, element("td", "", String(player.made)), element("td", "", String(player.suffered)));
      body.append(row);
    }
    tableNode.append(head, body);
    thefts.append(tableNode);
    const status = panel.querySelector("#cbv-status");
    status.textContent = storageError || (!logs ? "Aguardando os logs da mesa..."
      : "Histórico lido + salvo nesta mesa. Logs antigos não carregados podem faltar.");
    status.classList.toggle("cbv-error", Boolean(storageError));
    position();
  }

  function scan() {
    scanTimer = undefined;
    if (!panel?.isConnected) {
      if (!mount()) return;
      lastRender = "";
    }
    players = [...document.querySelectorAll('[id^="player_name_"]')].map((node) => ({
      id: node.id.slice("player_name_".length),
      name: (node.querySelector("a") || node).textContent.replace(/\s+/g, " ").trim()
    })).filter((player) => player.name);
    logs = document.getElementById("logs");
    let changed = false;
    for (const log of logs?.querySelectorAll(".log[id]") || []) {
      const event = stats.readLog(log, players);
      if (!event) continue;
      const previous = events.get(event.key);
      if (previous && JSON.stringify(previous) === JSON.stringify(event)) continue;
      events.set(event.key, event);
      changed = true;
    }
    if (changed) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 150);
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
  window.addEventListener("pagehide", () => {
    clearTimeout(saveTimer);
    void save();
  });
  scan();
})();
