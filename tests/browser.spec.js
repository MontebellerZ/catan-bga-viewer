const { test, expect, chromium } = require("@playwright/test");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");

let context;
let profile;
const root = path.resolve(__dirname, "..");
const rolls = '<div class="log" id="log_1" data-move-id="1">Ana de Souza lançou <div class="cat_log_token icon_die icon_die3"></div><div class="cat_log_token icon_die icon_die4"></div></div>'
  + '<div class="log" id="log_2" data-move-id="2">João lançou <div class="cat_log_token icon_die icon_die6"></div><div class="cat_log_token icon_die icon_die6"></div></div>';
const thefts = '<div class="log" id="log_3" data-move-id="3">Ana de Souza rouba de João</div>'
  + '<div class="log" id="log_4" data-move-id="4">João joga um cavaleiro</div>'
  + '<div class="log" id="log_5" data-move-id="5">João rouba de Ana de Souza</div>';
const gains = '<div class="log" id="log_6" data-move-id="8"><div class="roundedbox">João ganha <span>2<div class="cat_log_token icon_ore"></div>1<div class="cat_log_token icon_lumber"></div></span></div></div>'
  + '<div class="log" id="log_7" data-move-id="8"><div class="roundedbox">Jo não ganha nada</div></div>';

function fixture(logs, totals) {
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0}
    #cat_summary{position:absolute;right:5px;bottom:5px;width:224px;height:240px;background:#f0e2b1}
    #logs .icon_die{background-image:url(dice_model.png)}
    #logs .cat_log_token.icon_ore,#logs .cat_log_token.icon_lumber{background-image:url(cat_icons.png)}
    #cat_summary .cat_summary_icon{display:inline-block;width:12px;height:12px;background-image:url(cat_icons.png)}
    </style>
    <div id="game_play_area" style="position:relative;width:1000px">
      <div id="map_container" style="position:relative;height:740px;background:#1689bb">
        <div id="cat_map"></div>
        <div id="map_surface" style="position:absolute;inset:0">
          <div id="cat_summary">
            <div id="cat_summary_title">CUSTOS DE CONSTRUÇÃO</div>
            <button id="cat_summary_road" type="button">Estrada</button>
            <div id="cat_summary_costs_road">Madeira + Tijolo <div class="cat_summary_icon icon_lumber"></div><div class="cat_summary_icon icon_brick"></div></div>
            <div id="cat_summary_tr_content">4:1</div>
          </div>
        </div>
        <div id="cat_playerboard" style="position:absolute;top:30px;left:8px;width:110px;height:300px">
          <div id="cat_playerboard_resources">Sua Mão</div>
        </div>
      </div>
    </div>
    <div id="player_name_1"><a>Ana de Souza</a></div>
    <div id="player_name_2"><a>João</a></div>
    <div id="player_name_3"><a>Jo</a></div>
    <div id="overall_player_board_1"><div class="cat_color_0000ff"></div></div>
    <div id="overall_player_board_2"><div class="cat_color_ff0000"></div></div>
    <div id="overall_player_board_3"><div class="cat_color_00aa00"></div></div>
    <span id="cat_panel_score_resources_1">${totals[1]}</span>
    <span id="cat_panel_score_resources_2">${totals[2]}</span>
    <span id="cat_panel_score_resources_3">${totals[3]}</span>
    <div id="logs">${logs}</div>
    <script>
      window.originalSummary = document.getElementById("cat_summary");
      document.getElementById("cat_summary_road").addEventListener("click", () => {
        window.originalSummary.dataset.clicked = "true";
      });
    </script>`;
}

async function table(page, id, history = rolls + thefts + gains, game = "catan", totals = { 1: 0, 2: 5, 3: 0 }) {
  const state = { history, totals };
  await page.route("https://boardgamearena.com/**", (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname === "/tableview"
      ? `<iframe id="gameIframe" width="1100" height="900" src="/11/${game}?table=${url.searchParams.get("table")}"></iframe>`
      : fixture(state.history, state.totals);
    return route.fulfill({ contentType: "text/html; charset=utf-8", body });
  });
  await page.goto(`https://boardgamearena.com/tableview?table=${id}`);
  return { frame: page.frameLocator("#gameIframe"), state };
}

test.beforeAll(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), "cbv-test-"));
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
  });
});

test.afterAll(async () => {
  await context?.close();
  if (profile) await fs.rm(profile, { recursive: true, force: true });
});

test("extensão real no iframe: ordem prioritária das abas, contagens e posição original à direita", async () => {
  const page = await context.newPage();
  try {
    const { frame } = await table(page, "101");
    await expect(frame.getByRole("tab")).toHaveText(["Recursos", "Dados", "Roubos", "Custos"]);
    await expect(frame.getByRole("tab", { name: "Recursos", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(frame.locator("#cbv-resources")).toBeVisible();
    await expect(frame.locator("#cat_summary")).toBeHidden();
    await expect(frame.locator("#cbv-status")).toBeVisible();
    await expect(frame.locator("#cbv-toggle, .cbv-hide")).toHaveCount(0);
    await expect(frame.locator("#cbv-dice .cbv-total")).toHaveText("2 rolagens contabilizadas");
    await expect(page.locator("#cbv-panel")).toHaveCount(0);
    await frame.getByRole("tab", { name: "Roubos", exact: true }).click();
    await expect(frame.getByRole("tabpanel", { name: "Roubos" })).toBeVisible();
    await expect(frame.locator("#cbv-thefts .cbv-total")).toHaveText("2 roubos · 7 e cavaleiro");
    await expect(frame.locator("#cbv-thefts tbody tr").nth(0).locator("td")).toHaveText(["1", "1"]);
    await expect(frame.locator("#cbv-thefts tbody tr").nth(1).locator("td")).toHaveText(["1", "1"]);
    await expect(frame.locator("#cbv-thefts tbody tr").nth(2).locator("td")).toHaveText(["0", "0"]);
    await expect(frame.locator("#cbv-thefts tbody tr").nth(0).locator("th")).toHaveCSS("color", "rgb(0, 0, 255)");
    const theftButton = frame.locator("#cbv-thefts-history-button");
    await expect(theftButton).toHaveText("Histórico");
    await expect(theftButton).toHaveAttribute("aria-expanded", "false");
    await expect(frame.locator("#cbv-thefts table")).toBeVisible();
    await theftButton.click();
    const theftHistory = frame.locator("#cbv-theft-history .cbv-event");
    await expect(theftButton).toHaveText("Voltar");
    await expect(theftButton).toHaveAttribute("aria-expanded", "true");
    await expect(frame.locator("#cbv-thefts table")).toHaveCount(0);
    await expect(theftHistory).toHaveCount(2);
    await expect(theftHistory.first()).toHaveText("João roubou de Ana de Souza.");
    await theftButton.click();
    await expect(theftButton).toHaveText("Histórico");
    await expect(theftHistory).toHaveCount(0);
    await expect(frame.locator("#cbv-thefts table")).toBeVisible();
    await frame.getByRole("tab", { name: "Roubos", exact: true }).press("ArrowLeft");
    await expect(frame.getByRole("tab", { name: "Dados", exact: true })).toBeFocused();
    const rollButton = frame.locator("#cbv-dice-history-button");
    await expect(rollButton).toHaveText("Histórico");
    await expect(frame.locator("#cbv-dice .cbv-chart")).toBeVisible();
    await rollButton.click();
    const history = frame.locator("#cbv-roll-history .cbv-roll");
    await expect(rollButton).toHaveText("Voltar");
    await expect(frame.locator("#cbv-dice .cbv-chart")).toHaveCount(0);
    await expect(history).toHaveCount(2);
    await expect(history.nth(0)).toHaveAttribute("title", "Rolagem 2: João tirou 6 + 6 = 12");
    await expect(history.nth(0)).toHaveClass(/cbv-latest/);
    await expect(history.nth(1)).toHaveAttribute("title", "Rolagem 1: Ana de Souza tirou 3 + 4 = 7");
    await expect(history.nth(1).locator(".cbv-sum")).toHaveClass(/cbv-seven/);
    await expect(history.nth(0).locator(".cbv-die").nth(0).locator(".cbv-pip")).toHaveCount(6);
    await expect(history.nth(1).locator(".cbv-die").nth(1).locator(".cbv-pip")).toHaveCount(4);
    await rollButton.click();
    await expect(rollButton).toHaveText("Histórico");
    await expect(history).toHaveCount(0);
    await expect(frame.locator("#cbv-dice .cbv-chart")).toBeVisible();
    expect(await frame.locator(".cbv-tabs button").evaluateAll((tabs) =>
      tabs.filter((tab) => tab.scrollWidth > tab.clientWidth).map((tab) => tab.textContent))).toEqual([]);
    await frame.getByRole("tab", { name: "Dados", exact: true }).press("ArrowLeft");
    await expect(frame.getByRole("tab", { name: "Recursos", exact: true })).toBeFocused();
    await expect(frame.locator("#cbv-resources")).toBeVisible();
    await frame.getByRole("tab", { name: "Dados", exact: true }).click();
    await expect(frame.locator("#cbv-dice")).toBeVisible();
    const bounds = await frame.locator("#cbv-panel").evaluate((panel) => {
      const rect = panel.getBoundingClientRect();
      const area = document.getElementById("map_surface").getBoundingClientRect();
      const rows = [...panel.querySelectorAll(".cbv-row")].map((row) => {
        const bar = row.querySelector(".cbv-bar").getBoundingClientRect();
        const count = row.querySelector(".cbv-bar > .cbv-count").getBoundingClientRect();
        return { top: row.getBoundingClientRect().top, width: bar.width, inside: count.left >= bar.left && Math.abs(bar.right - count.right - 4) < 1 };
      });
      return {
        bottomGap: area.bottom - rect.bottom,
        rightGap: area.right - rect.right,
        rows: rows.length,
        stacked: rows.every((row, index) => index === 0 || row.top > rows[index - 1].top),
        countsInside: rows.every((row) => row.inside),
        longestIsFull: Math.max(...rows.map((row) => row.width)) > Math.min(...rows.map((row) => row.width)),
      };
    });
    expect(bounds).toEqual({ bottomGap: 5, rightGap: 5, rows: 11, stacked: true, countsInside: true, longestIsFull: true });
    await frame.getByRole("tab", { name: "Dados", exact: true }).press("Home");
    await expect(frame.getByRole("tab", { name: "Recursos", exact: true })).toBeFocused();
    await expect(frame.locator("#cbv-resources")).toBeVisible();
    await frame.getByRole("tab", { name: "Recursos", exact: true }).press("End");
    await expect(frame.getByRole("tab", { name: "Custos de construção" })).toBeFocused();
    await expect(frame.locator("#cat_summary")).toBeVisible();
    await frame.getByRole("tab", { name: "Recursos", exact: true }).click();
    // João: 3 cards from the log plus 2 the BGA panel shows that predate it; both thefts hit unseen cards.
    await expect(frame.locator("#cbv-resources .cbv-total").first()).toHaveText("Mão estimada · 5 cartas");
    const resourceButton = frame.locator("#cbv-resources-history-button");
    await expect(resourceButton).toHaveText("Histórico");
    await resourceButton.click();
    await expect(resourceButton).toHaveText("Voltar");
    await expect(frame.locator("#cbv-resources table")).toHaveCount(0);
    await expect(frame.locator("#cbv-resource-history .cbv-event")).toHaveCount(1);
    await expect(frame.locator("#cbv-resource-history .cbv-event").first()).toHaveText("João recebe +1 e +2");
    await expect(frame.locator("#cbv-resource-history .cbv-event .cbv-res").first()).toHaveAttribute("aria-label", "Madeira");
    await expect(frame.locator("#cbv-resource-history .cbv-event .cbv-resource-gain").first()).toHaveCSS("color", "rgb(40, 119, 58)");
    await resourceButton.click();
    await expect(resourceButton).toHaveText("Histórico");
    await expect(frame.locator("#cbv-resource-history .cbv-event")).toHaveCount(0);
    await expect(frame.locator("#cbv-resources table").first()).toBeVisible();
    const hand = frame.locator("#cbv-resources table").first();
    await expect(hand.locator("thead th").nth(6)).toHaveText("?");
    await expect(hand.locator("tbody tr").nth(1).locator("td")).toHaveText(["1", "0", "0", "0", "2", "2", "5"]);
    await expect(hand.locator("tbody tr").nth(0).locator("td")).toHaveText(["0", "0", "0", "0", "0", "0", "0"]);
    await expect(hand.locator("tbody tr").nth(1).locator(".cbv-uncertain")).toHaveCount(1);
    // A panel counter lagging behind its log (animation) keeps the settled estimate; only a lasting mismatch is adopted.
    const counter = frame.locator("#cat_panel_score_resources_3");
    const third = hand.locator("tbody tr").nth(2).locator("td");
    const settledRow = await third.allTextContents();
    await counter.evaluate((node) => { node.textContent = "1"; });
    await page.waitForTimeout(500);
    await expect(third).toHaveText(settledRow);
    await counter.evaluate((node) => { node.textContent = "0"; });
    await page.waitForTimeout(300);
    await expect(third).toHaveText(settledRow);
    await counter.evaluate((node) => { node.textContent = "1"; });
    await expect(third.nth(5)).toHaveText("1", { timeout: 8000 });
    await counter.evaluate((node) => { node.textContent = "0"; });
    await expect(third).toHaveText(settledRow, { timeout: 8000 });
    const production = frame.locator("#cbv-resources table").last();
    await expect(production.locator("thead .cbv-res")).toHaveCount(5);
    for (const image of await production.locator("thead .cbv-res").evaluateAll((icons) => icons.map((icon) => icon.style.backgroundImage))) {
      expect(image).toContain("cat_icons.png");
    }
    await expect(production.locator("tbody tr").nth(1).locator("td")).toHaveText(["1", "0", "0", "0", "2", "3"]);
    await expect(production.locator("tbody tr").nth(2).locator("td")).toHaveText(["0", "0", "0", "0", "0", "0"]);
    await expect(frame.locator("#cbv-resources")).toContainText("Tabuleiro não encontrado");
    // João's settlement touches grain 6 (robber) and brick 4: the robber colours grain, it doesn't subtract it.
    await frame.locator("#cat_map").evaluate((map) => {
      map.style.cssText = "position:absolute;left:0;top:0;width:600px;height:600px";
      map.innerHTML = '<div id="cathex_1_1" class="cat_hex cat_Field" style="position:absolute;left:300px;top:300px;width:120px;height:140px"><div class="cat_num_token cat_num_6"></div><div id="cat_robber"></div></div>'
        + '<div id="cathex_1_2" class="cat_hex cat_Hills" style="position:absolute;left:420px;top:300px;width:120px;height:140px"><div class="cat_num_token cat_num_4"></div></div>'
        + '<div class="cat_place_living" style="position:absolute;left:410px;top:290px;width:20px;height:20px"><div class="cat_building cat_settlement cat_color_ff0000"></div></div>';
    });
    const joao = frame.locator("#cbv-resources table").nth(1).locator("tbody tr").nth(1).locator("td");
    await expect(joao).toHaveText(["0", "3", "0", "5", "0", "8"]);
    await expect(frame.locator("#cbv-resources .cbv-robbed")).toHaveCount(1);
    await expect(joao.nth(3)).toHaveClass(/cbv-robbed/);
    await expect(joao.nth(3)).toHaveCSS("color", "rgb(192, 38, 27)");
    await expect(frame.locator("#cbv-resources")).toContainText("Em vermelho: sob o ladrão.");
    await frame.getByRole("tab", { name: "Recursos", exact: true }).press("ArrowLeft");
    await expect(frame.getByRole("tab", { name: "Custos de construção" })).toBeFocused();
  } finally {
    await page.close();
  }
});

test("históricos mostram deltas com ícones, cores dos jogadores e rolagem da área inteira", async () => {
  const theftLogs = Array.from({ length: 24 }, (_, index) =>
    `<div class="log" id="log_theft_${index}" data-move-id="${100 + index}"><div class="roundedbox">João rouba de Ana de Souza</div></div>`
  ).join("");
  const rollLogs = Array.from({ length: 24 }, (_, index) =>
    `<div class="log" id="log_roll_${index}" data-move-id="${200 + index}"><div class="roundedbox">João lançou <div class="cat_log_token icon_die icon_die3"></div><div class="cat_log_token icon_die icon_die4"></div></div></div>`
  ).join("");
  const history = '<div class="log" id="log_theft_revealed" data-move-id="1"><div class="roundedbox">João rouba de Ana de Souza</div></div>'
    + '<div class="log" id="log_reveal" data-move-id="1"><div class="roundedbox">Você recebe <span><div class="cat_log_token icon_wool"></div></span></div></div>'
    + '<div class="log" id="log_theft_unknown" data-move-id="2"><div class="roundedbox">Ana de Souza rouba de João</div></div>'
    + '<div class="log" id="log_gain" data-move-id="30"><div class="roundedbox">João ganha <span><div class="cat_log_token icon_ore"></div></span></div></div>'
    + '<div class="log" id="log_trade" data-move-id="33"><div class="roundedbox">João negocia com o banco: <span>4<div class="cat_log_token icon_ore"></div></span> → <span><div class="cat_log_token icon_wool"></div></span></div></div>'
    + '<div class="log" id="log_build" data-move-id="34"><div class="roundedbox">João constrói uma estrada por <span><div class="cat_log_token icon_lumber"></div><div class="cat_log_token icon_brick"></div></span></div></div>'
    + '<div class="log" id="log_roll" data-move-id="35"><div class="roundedbox">João lançou <div class="cat_log_token icon_die icon_die3"></div><div class="cat_log_token icon_die icon_die4"></div></div></div>'
    + theftLogs + rollLogs;
  const page = await context.newPage();
  try {
    const { frame } = await table(page, "103", history);
    await frame.getByRole("tab", { name: "Recursos", exact: true }).click();
    const resourceButton = frame.locator("#cbv-resources-history-button");
    await resourceButton.click();
    const resourceRows = frame.locator("#cbv-resource-history .cbv-event");
    await expect(resourceRows).toHaveCount(4);
    await expect(resourceRows.nth(0)).toHaveText("João construiu uma estrada: -1 e -1");
    expect(await resourceRows.nth(0).locator(".cbv-res").evaluateAll((icons) =>
      icons.map((icon) => icon.getAttribute("aria-label")))).toEqual(["Madeira", "Tijolo"]);
    await expect(resourceRows.nth(0).locator(".cbv-resource-loss").first()).toHaveCSS("color", "rgb(177, 38, 27)");
    await expect(resourceRows.nth(0).locator(".cbv-player-name")).toHaveCSS("color", "rgb(255, 0, 0)");
    await expect(resourceRows.nth(1)).toHaveText("João trocou com o banco: -4 e +1");
    expect(await resourceRows.nth(1).locator(".cbv-res").evaluateAll((icons) =>
      icons.map((icon) => icon.getAttribute("aria-label")))).toEqual(["Minério", "Lã"]);
    await expect(resourceRows.nth(1).locator(".cbv-resource-gain")).toHaveCSS("color", "rgb(40, 119, 58)");
    await expect(resourceRows.nth(2)).toHaveText("João recebe +1");
    await expect(resourceRows.nth(2).locator(".cbv-resource-gain")).toHaveCSS("color", "rgb(40, 119, 58)");
    await expect(resourceRows.nth(3)).toHaveText("Roubo revelado: você recebe +1");
    await expect(resourceRows.nth(3).locator(".cbv-res")).toHaveAttribute("aria-label", "Lã");

    await frame.getByRole("tab", { name: "Roubos", exact: true }).click();
    const theftTableName = frame.locator("#cbv-thefts tbody tr").nth(0).locator("th");
    await expect(theftTableName).toHaveCSS("color", "rgb(0, 0, 255)");
    const theftButton = frame.locator("#cbv-thefts-history-button");
    await theftButton.click();
    const theftBody = frame.locator("#cbv-thefts");
    const theftRows = frame.locator("#cbv-theft-history .cbv-event");
    await expect(theftRows).toHaveCount(26);
    const revealedTheft = theftRows.filter({ has: frame.locator('.cbv-res[aria-label="Lã"]') });
    await expect(revealedTheft).toHaveCount(1);
    await expect(revealedTheft.first()).toContainText("João roubou de Ana de Souza: 1");
    const unknownTheft = theftRows.filter({ hasText: "Ana de Souza roubou de João" }).first();
    await expect(unknownTheft.locator(".cbv-res")).toHaveCount(0);
    await expect(unknownTheft.locator(".cbv-player-name").first()).toHaveCSS("color", "rgb(0, 0, 255)");
    const scroll = await theftBody.evaluate((body) => ({
      clientHeight: body.clientHeight,
      scrollHeight: body.scrollHeight,
      overflow: getComputedStyle(body).overflowY,
      innerOverflow: getComputedStyle(body.querySelector(".cbv-history-content")).overflowY,
      thumb: getComputedStyle(body, "::-webkit-scrollbar-thumb").backgroundColor
    }));
    expect(scroll.overflow).toBe("auto");
    expect(scroll.innerOverflow).toBe("visible");
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
    expect(["rgb(185, 146, 69)", "rgb(163, 126, 53)"]).toContain(scroll.thumb);
    const headerBefore = await theftButton.boundingBox();
    await theftBody.evaluate((body) => { body.scrollTop = body.scrollHeight; });
    const headerAfter = await theftButton.boundingBox();
    expect(headerAfter.y).toBeLessThan(headerBefore.y);

    await frame.getByRole("tab", { name: "Dados", exact: true }).click();
    await frame.locator("#cbv-dice-history-button").click();
    await expect(frame.locator("#cbv-roll-history .cbv-roll-name").first()).toHaveCSS("color", "rgb(255, 0, 0)");
    await frame.getByRole("tab", { name: "Recursos", exact: true }).click();
    await frame.locator("#cbv-resources-history-button").click();
    await expect(frame.locator("#cbv-resources table").first().locator("tbody tr").nth(1).locator("th"))
      .toHaveCSS("color", "rgb(255, 0, 0)");

    await frame.getByRole("tab", { name: "Dados", exact: true }).click();
    const diceButton = frame.locator("#cbv-dice-history-button");
    await expect(diceButton).toHaveText("Voltar");
    await diceButton.click();
    await frame.locator("#cbv-panel").evaluate((panel) => panel.style.setProperty("--cbv-summary-height", "360px"));
    const rowHeights = await frame.locator("#cbv-dice .cbv-row").evaluateAll((rows) =>
      rows.map((row) => row.getBoundingClientRect().height));
    expect(Math.max(...rowHeights)).toBeGreaterThanOrEqual(17);
    await diceButton.click();
    const diceBody = frame.locator("#cbv-dice");
    await expect(frame.locator("#cbv-roll-history .cbv-roll")).toHaveCount(25);
    const diceScroll = await diceBody.evaluate((body) => ({
      clientHeight: body.clientHeight,
      scrollHeight: body.scrollHeight,
      overflow: getComputedStyle(body).overflowY
    }));
    expect(diceScroll.overflow).toBe("auto");
    expect(diceScroll.scrollHeight).toBeGreaterThan(diceScroll.clientHeight);
    const diceButtonBefore = await diceButton.boundingBox();
    await diceBody.evaluate((body) => { body.scrollTop = body.scrollHeight; });
    const diceButtonAfter = await diceButton.boundingBox();
    expect(diceButtonAfter.y).toBeLessThan(diceButtonBefore.y);
  } finally {
    await page.close();
  }
});

test("novos logs, duplicatas e cache verdadeiro do Chrome após recarregar", async () => {
  const page = await context.newPage();
  try {
    const { frame, state } = await table(page, "102");
    await expect(frame.locator("#cbv-dice .cbv-total")).toHaveText("2 rolagens contabilizadas");
    await frame.locator("#logs").evaluate((logs) => {
      const duplicate = logs.querySelector("#log_1").cloneNode(true);
      duplicate.id = "log_999";
      logs.append(duplicate);
      const fresh = duplicate.cloneNode(true);
      fresh.id = "log_1000";
      fresh.setAttribute("data-move-id", "6");
      logs.append(fresh);
      const theft = logs.querySelector("#log_3").cloneNode(true);
      theft.id = "log_1001";
      theft.setAttribute("data-move-id", "7");
      logs.prepend(theft);
    });
    await expect(frame.locator("#cbv-dice .cbv-total")).toHaveText("3 rolagens contabilizadas");
    await expect(frame.locator("#cbv-thefts .cbv-total")).toHaveText("3 roubos · 7 e cavaleiro");
    // Let the debounced chrome.storage write finish before destroying the frame.
    await page.waitForTimeout(350);
    state.history = rolls;
    await page.reload();
    await expect(frame.locator("#cbv-dice .cbv-total")).toHaveText("3 rolagens contabilizadas");
    await expect(frame.locator("#cbv-thefts .cbv-total")).toHaveText("3 roubos · 7 e cavaleiro");
    await page.goto("https://boardgamearena.com/tableview?table=999");
    await expect(frame.locator("#cbv-dice .cbv-total")).toHaveText("2 rolagens contabilizadas");
    await expect(frame.locator("#cbv-thefts .cbv-total")).toHaveText("0 roubos · 7 e cavaleiro");
    // Start of a game: only dice in the log, so the resource sprite must come from the cost box.
    const icons = frame.locator("#cbv-resources table").first().locator("thead .cbv-res");
    await expect(icons).toHaveCount(5);
    for (const image of await icons.evaluateAll((nodes) => nodes.map((icon) => icon.style.backgroundImage))) {
      expect(image).toContain("cat_icons.png");
    }
    // Back to table 102 after missing moves 9-19: the estimate restarts from the loaded logs,
    // so all 5 cards on João's BGA panel become unassigned instead of reusing the stale record.
    state.history = '<div class="log" id="log_1" data-move-id="20">Jo lançou <div class="cat_log_token icon_die icon_die1"></div><div class="cat_log_token icon_die icon_die2"></div></div>';
    await page.goto("https://boardgamearena.com/tableview?table=102");
    await expect(frame.locator("#cbv-dice .cbv-total")).toHaveText("4 rolagens contabilizadas");
    await expect(frame.locator("#cbv-resources table").first().locator("tbody tr").nth(1).locator("td"))
      .toHaveText(["0", "0", "0", "0", "0", "5", "5"]);
  } finally {
    await page.close();
  }
});

test("recalcular substitui os logs recentes do cache sem perder os antigos", async () => {
  const oldRoll = rolls.slice(0, rolls.indexOf('<div class="log" id="log_2"'));
  const recentRoll = '<div class="log" id="log_20" data-move-id="20">João lançou <div class="cat_log_token icon_die icon_die6"></div><div class="cat_log_token icon_die icon_die6"></div></div>';
  const recentTheft = '<div class="log" id="log_21" data-move-id="21">João rouba de Ana de Souza</div>';
  const gain = '<div class="log" id="log_22" data-move-id="22">João ganha <span>2<div class="cat_log_token icon_lumber"></div></span></div>';
  const corrected = recentRoll.replaceAll("icon_die6", "icon_die1")
    + '<div class="log" id="log_21" data-move-id="21">João passa</div>'
    + gain.replace("icon_lumber", "icon_ore");
  const page = await context.newPage();
  try {
    const { frame, state } = await table(page, "114", oldRoll + recentRoll + recentTheft + gain,
      "catan", { 1: 0, 2: 2, 3: 0 });
    await expect(frame.locator("#cbv-thefts .cbv-total")).toHaveText("1 roubos · 7 e cavaleiro");
    await page.waitForTimeout(350);
    state.history = corrected;
    await page.reload();
    await expect(frame.locator("#cbv-thefts .cbv-total")).toHaveText("1 roubos · 7 e cavaleiro");
    const reload = frame.getByRole("button", { name: "Recalcular logs", exact: true });
    const row = frame.locator("#cbv-resources table").first().locator("tbody tr").nth(1).locator("td");
    const footerLayout = async () => reload.evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      const panel = button.closest("#cbv-panel").getBoundingClientRect();
      const status = document.getElementById("cbv-status").getBoundingClientRect();
      return {
        right: panel.right - bounds.right,
        bottom: panel.bottom - bounds.bottom,
        separated: status.right <= bounds.left,
        sameRow: status.top < bounds.bottom && bounds.top < status.bottom
      };
    });
    expect(await footerLayout()).toEqual({ right: 6, bottom: 6, separated: true, sameRow: true });
    await reload.click();
    await expect(row).toHaveText(["0", "0", "0", "0", "2", "0", "2"]);
    await expect(frame.locator("#cbv-thefts .cbv-total")).toHaveText("0 roubos · 7 e cavaleiro");
    await expect(frame.locator("#cbv-dice .cbv-total")).toHaveText("2 rolagens contabilizadas");
    await expect(frame.locator("#cbv-status")).toContainText("recalculados");
    expect(await footerLayout()).toEqual({ right: 6, bottom: 6, separated: true, sameRow: true });
    await reload.click();
    await expect(row).toHaveText(["0", "0", "0", "0", "2", "0", "2"]);
    await frame.getByRole("tab", { name: "Dados", exact: true }).click();
    await frame.locator("#cbv-dice-history-button").click();
    await expect(frame.locator("#cbv-roll-history .cbv-sum")).toHaveText(["2", "7"]);
    await reload.click();
    await expect(frame.locator("#cbv-dice-history-button")).toHaveText("Voltar");
    await frame.getByRole("tab", { name: "Custos de construção", exact: true }).click();
    await expect(reload).toBeVisible();
    await reload.click();
    await expect(frame.locator("#cat_summary")).toBeVisible();
    await page.waitForTimeout(350);
    await page.reload();
    await expect(row).toHaveText(["0", "0", "0", "0", "2", "0", "2"]);
    await expect(frame.locator("#cbv-thefts .cbv-total")).toHaveText("0 roubos · 7 e cavaleiro");
    await expect(frame.locator("#cbv-dice .cbv-total")).toHaveText("2 rolagens contabilizadas");
    await frame.locator("#logs").evaluate((logs) => {
      logs.insertAdjacentHTML("beforeend", '<div class="log" id="log_23" data-move-id="22">João ganha <span><div class="cat_log_token icon_grain"></div></span></div>');
      document.getElementById("cat_panel_score_resources_2").textContent = "3";
    });
    await expect(row).toHaveText(["0", "0", "0", "1", "2", "0", "3"]);
  } finally {
    await page.close();
  }
});

test("recalcular reinicia uma mão sincronizada e aguarda logs quando estão ausentes", async () => {
  const gain = '<div class="log" id="log_1" data-move-id="1">João ganha <span>4<div class="cat_log_token icon_lumber"></div></span></div>';
  const page = await context.newPage();
  try {
    const { frame } = await table(page, "115", "", "catan", { 1: 0, 2: 1, 3: 0 });
    const reload = frame.getByRole("button", { name: "Recalcular logs", exact: true });
    await expect(reload).toBeDisabled();
    await frame.locator("#logs").evaluate((logs, html) => { logs.innerHTML = html; }, gain);
    await expect(reload).toBeEnabled();
    const row = frame.locator("#cbv-resources table").first().locator("tbody tr").nth(1).locator("td");
    await expect(row).toHaveText(["0", "0", "0", "0", "0", "1", "1"], { timeout: 7000 });
    await expect(frame.locator("#cbv-status")).toContainText("sincronizada com a BGA");
    await frame.locator("#log_1").evaluate((log) => {
      log.innerHTML = 'João ganha <span><div class="cat_log_token icon_lumber"></div></span>';
    });
    await reload.click();
    await expect(row).toHaveText(["1", "0", "0", "0", "0", "0", "1"]);
    await expect(frame.locator("#cbv-status")).toContainText("recalculados");
    await page.waitForTimeout(350);
    await page.reload();
    await expect(row).toHaveText(["1", "0", "0", "0", "0", "0", "1"]);
    await expect(reload).toBeDisabled();
  } finally {
    await page.close();
  }
});

test("aguarda o carregamento inicial antes de reconciliar logs e totais da BGA", async () => {
  const partial = '<div id="loader_mask" style="display:flex">Carregando</div>'
    + '<div class="log" id="log_1" data-move-id="1">João ganha <span>4<div class="cat_log_token icon_lumber"></div></span></div>'
    + '<div class="log" id="log_2"><div class="roundedbox"><p><button class="replay_last_move_button">Repetição dos últimos movimentos</button></p></div></div>';
  const spend = '<div class="log" id="log_3" data-move-id="2">João descarta <span>3<div class="cat_log_token icon_lumber"></div></span></div>';
  const page = await context.newPage();
  try {
    const { frame, state } = await table(page, "116", partial, "catan", { 1: 0, 2: 1, 3: 0 });
    await expect(frame.locator("#cbv-panel")).toBeAttached();
    await page.waitForTimeout(4500);
    await expect(frame.locator("#cbv-status")).toContainText("Aguardando a BGA");
    await expect(frame.locator("#cbv-reload")).toBeDisabled();
    await frame.locator("#logs").evaluate((logs, html) => {
      logs.insertAdjacentHTML("beforeend", html);
      document.getElementById("loader_mask").style.display = "none";
    }, spend);
    const row = frame.locator("#cbv-resources table").first().locator("tbody tr").nth(1).locator("td");
    await expect(row).toHaveText(["1", "0", "0", "0", "0", "0", "1"]);
    await expect(frame.locator("#cbv-status")).not.toContainText("sincronizada com a BGA");
    await frame.locator("#cbv-reload").click();
    await expect(row).toHaveText(["1", "0", "0", "0", "0", "0", "1"]);
    await page.waitForTimeout(350);
    state.history = partial + spend;
    await page.reload();
    await expect(frame.locator("#cbv-status")).toContainText("Aguardando a BGA");
    // BGA can hide its loader by changing only a style attribute, without another log mutation.
    await frame.locator("#loader_mask").evaluate((mask) => { mask.style.display = "none"; });
    await expect(row).toHaveText(["1", "0", "0", "0", "0", "0", "1"]);
  } finally {
    await page.close();
  }
});

test("associa cartas reveladas sem jogada ao roubo próximo e não duplica ao reabrir", async () => {
  const gain = '<div class="log" id="log_1" data-move-id="110">Ana de Souza ganha <span><div class="cat_log_token icon_lumber"></div><div class="cat_log_token icon_ore"></div></span></div>';
  const reveal = '<div class="log" id="log_17">Você recebe <span><div class="cat_log_token icon_ore"></div></span></div>';
  const theft = '<div class="log" id="log_18" data-move-id="116">João move o Ladrão</div>'
    + '<div class="log" id="log_19" data-move-id="116">João rouba de Ana de Souza</div>';
  const replay = '<div class="log" id="log_20"><div class="roundedbox"><p><button class="replay_last_move_button">Repetição dos últimos movimentos</button></p></div></div>';
  const page = await context.newPage();
  try {
    const { frame, state } = await table(page, "117", gain + reveal + replay,
      "catan", { 1: 2, 2: 0, 3: 0 });
    const rows = frame.locator("#cbv-resources table").first().locator("tbody tr");
    const victim = rows.nth(0).locator("td");
    const thief = rows.nth(1).locator("td");
    await expect(victim).toHaveText(["1", "0", "0", "0", "1", "0", "2"]);
    await frame.locator("#logs").evaluate((logs, html) => {
      document.getElementById("cat_panel_score_resources_1").textContent = "1";
      document.getElementById("cat_panel_score_resources_2").textContent = "1";
      logs.insertAdjacentHTML("beforeend", html);
    }, theft);
    state.totals = { 1: 1, 2: 1, 3: 0 };
    await expect(victim).toHaveText(["1", "0", "0", "0", "0", "0", "1"]);
    await expect(thief).toHaveText(["0", "0", "0", "0", "1", "0", "1"]);
    await frame.getByRole("tab", { name: "Roubos", exact: true }).click();
    await frame.locator("#cbv-thefts-history-button").click();
    await expect(frame.locator('#cbv-theft-history .cbv-res[aria-label="Minério"]')).toHaveCount(1);
    await page.waitForTimeout(350);

    // Visual log IDs and private-note ordering can change after reopening the table.
    let nextId = 100;
    state.history = (gain + theft + reveal + replay).replace(/id="log_\d+"/g, () => `id="log_${++nextId}"`);
    await page.reload();
    await expect(victim).toHaveText(["1", "0", "0", "0", "0", "0", "1"]);
    await expect(thief).toHaveText(["0", "0", "0", "0", "1", "0", "1"]);
    await frame.locator("#cbv-resources-history-button").click();
    await expect(frame.locator("#cbv-resource-history .cbv-event")).toHaveCount(2);
    await frame.locator("#cbv-reload").click();
    await expect(frame.locator("#cbv-resource-history .cbv-event")).toHaveCount(2);
    await frame.locator("#cbv-resources-history-button").click();
    await expect(thief).toHaveText(["0", "0", "0", "0", "1", "0", "1"]);
  } finally {
    await page.close();
  }
});

test("não atribui uma revelação ambígua entre dois roubos a uma jogada arbitrária", async () => {
  const history = '<div class="log" id="log_1" data-move-id="1">Ana de Souza ganha <span><div class="cat_log_token icon_lumber"></div><div class="cat_log_token icon_ore"></div></span></div>'
    + '<div class="log" id="log_2" data-move-id="2">João rouba de Ana de Souza</div>'
    + '<div class="log" id="log_3">Você perde <span><div class="cat_log_token icon_ore"></div></span></div>'
    + '<div class="log" id="log_4" data-move-id="3">Jo rouba de Ana de Souza</div>';
  const page = await context.newPage();
  try {
    const { frame } = await table(page, "118", history, "catan", { 1: 0, 2: 1, 3: 1 });
    const rows = frame.locator("#cbv-resources table").first().locator("tbody tr");
    for (const index of [1, 2]) {
      await expect(rows.nth(index).locator("td")).toHaveText(["0", "0", "0", "0", "0", "1", "1"]);
    }
    await frame.getByRole("tab", { name: "Roubos", exact: true }).click();
    await frame.locator("#cbv-thefts-history-button").click();
    await expect(frame.locator("#cbv-theft-history .cbv-event")).toHaveCount(2);
    await expect(frame.locator("#cbv-theft-history .cbv-res")).toHaveCount(0);
  } finally {
    await page.close();
  }
});

test("divergência persistente sincroniza a mão com a BGA e continua após recarregar", async () => {
  const firstGain = '<div class="log" id="log_1" data-move-id="1"><div class="roundedbox">João ganha <span>4<div class="cat_log_token icon_lumber"></div></span></div></div>'
    + '<div class="log" id="log_2" data-move-id="1"><div class="roundedbox">Ana de Souza ganha <span>2<div class="cat_log_token icon_grain"></div></span></div></div>';
  const nextGain = '<div class="log" id="log_3" data-move-id="1"><div class="roundedbox">João ganha <span>2<div class="cat_log_token icon_ore"></div></span></div></div>';
  const page = await context.newPage();
  try {
    const { frame, state } = await table(page, "110", firstGain, "catan", { 1: 2, 2: 1, 3: 0 });
    const hands = frame.locator("#cbv-resources table").first().locator("tbody tr");
    const row = hands.nth(1).locator("td");
    const other = hands.nth(0).locator("td");
    await expect(row).toHaveText(["4", "0", "0", "0", "0", "0", "4*"]);

    await frame.locator("#map_container").evaluate((node) => node.append(document.createTextNode(" ")));
    await page.waitForTimeout(300);
    expect(await row.last().textContent()).toBe("4*");

    const corrected = ["0", "0", "0", "0", "0", "1", "1"];
    await expect(row).toHaveText(corrected, { timeout: 7000 });
    await expect(other).toHaveText(["0", "0", "0", "2", "0", "0", "2"]);
    await expect(frame.locator("#cbv-status")).toContainText("BGA");
    await expect(frame.locator("#cbv-resources table").last().locator("tbody tr").nth(1).locator("td"))
      .toHaveText(["4", "0", "0", "0", "0", "4"]);
    await page.waitForTimeout(4500);
    await expect(row).toHaveText(corrected);

    await frame.locator("#cat_panel_score_resources_2").evaluate((counter) => { counter.textContent = "2"; });
    await expect(row).toHaveText(["0", "0", "0", "0", "0", "2", "2"], { timeout: 7000 });
    await expect(other).toHaveText(["0", "0", "0", "2", "0", "0", "2"]);
    await frame.locator("#logs").evaluate((logs, html) => {
      logs.insertAdjacentHTML("beforeend", html);
      document.getElementById("cat_panel_score_resources_2").textContent = "4";
    }, nextGain);
    const updated = ["0", "0", "0", "0", "2", "2", "4"];
    await expect(row).toHaveText(updated);
    await page.waitForTimeout(350);
    state.history = firstGain + nextGain;
    state.totals = { 1: 2, 2: 4, 3: 0 };
    await page.reload();
    await expect(row).toHaveText(updated);
    await expect(other).toHaveText(["0", "0", "0", "2", "0", "0", "2"]);

    const build = '<div class="log" id="log_4" data-move-id="2"><div class="roundedbox">João constrói uma estrada por <span><div class="cat_log_token icon_ore"></div><div class="cat_log_token icon_lumber"></div></span></div></div>';
    await frame.locator("#logs").evaluate((logs, html) => {
      logs.insertAdjacentHTML("beforeend", html);
      document.getElementById("cat_panel_score_resources_2").textContent = "2";
    }, build);
    await expect(row).toHaveText(["0", "0", "0", "0", "1", "1", "2"]);
    await frame.locator("#logs").evaluate((logs, html) => {
      logs.insertAdjacentHTML("beforeend", html);
      document.getElementById("cat_panel_score_resources_2").textContent = "4";
    }, rollback(5, 2));
    await expect(row).toHaveText(updated);

    await page.waitForTimeout(350);
    state.history = '<div class="log" id="log_10" data-move-id="10"><div class="roundedbox">João ganha <span>2<div class="cat_log_token icon_brick"></div></span></div></div>';
    state.totals = { 1: 2, 2: 4, 3: 0 };
    await page.reload();
    await expect(row).toHaveText(["0", "2", "0", "0", "0", "2", "4"]);
  } finally {
    await page.close();
  }
});

test("uma animação atrasada após período ocioso não reinicia a mão", async () => {
  const first = '<div class="log" id="log_1" data-move-id="1"><div class="roundedbox">João ganha <span>4<div class="cat_log_token icon_lumber"></div></span></div></div>';
  const next = '<div class="log" id="log_2" data-move-id="2"><div class="roundedbox">João ganha <span><div class="cat_log_token icon_ore"></div></span></div></div>';
  const page = await context.newPage();
  try {
    const { frame } = await table(page, "111", first, "catan", { 1: 0, 2: 4, 3: 0 });
    const row = frame.locator("#cbv-resources table").first().locator("tbody tr").nth(1).locator("td");
    await expect(row).toHaveText(["4", "0", "0", "0", "0", "0", "4"]);
    await page.waitForTimeout(4200);
    await frame.locator("#logs").evaluate((logs, html) => logs.insertAdjacentHTML("beforeend", html), next);
    await expect(row).toHaveText(["4", "0", "0", "0", "1", "0", "5"]);
    await page.waitForTimeout(500);
    await frame.locator("#cat_panel_score_resources_2").evaluate((counter) => { counter.textContent = "5"; });
    await page.waitForTimeout(4500);
    await expect(row).toHaveText(["4", "0", "0", "0", "1", "0", "5"]);
    await expect(frame.locator("#cbv-status")).not.toContainText("sincronizada com a BGA");
  } finally {
    await page.close();
  }
});

test("aguarda a aba voltar ao primeiro plano antes de sincronizar", async () => {
  const gain = '<div class="log" id="log_1" data-move-id="1"><div class="roundedbox">João ganha <span>4<div class="cat_log_token icon_lumber"></div></span></div></div>';
  const page = await context.newPage();
  try {
    const devtools = await context.newCDPSession(page);
    const contexts = [];
    devtools.on("Runtime.executionContextCreated", ({ context: created }) => contexts.push(created));
    await devtools.send("Runtime.enable");
    const { frame } = await table(page, "113", gain, "catan", { 1: 0, 2: 1, 3: 0 });
    const row = frame.locator("#cbv-resources table").first().locator("tbody tr").nth(1).locator("td");
    await expect(row).toHaveText(["4", "0", "0", "0", "0", "0", "4*"]);

    // Headless Chromium keeps tabs visible; override visibility in the extension's isolated world.
    const tree = await devtools.send("Page.getFrameTree");
    const gameFrame = tree.frameTree.childFrames.find(({ frame: child }) => child.url.includes("/11/catan?"));
    const extension = contexts.find((created) => created.auxData.frameId === gameFrame.frame.id
      && created.origin.startsWith("chrome-extension://"));
    expect(extension).toBeTruthy();
    const setHidden = async (hidden) => {
      const result = await devtools.send("Runtime.evaluate", {
        contextId: extension.id,
        expression: `Object.defineProperty(document, "hidden", { configurable: true, value: ${hidden} }); document.dispatchEvent(new Event("visibilitychange"));`
      });
      expect(result.exceptionDetails).toBeUndefined();
    };
    await setHidden(true);
    await page.waitForTimeout(4500);
    expect(await row.last().textContent()).toBe("4*");
    await setHidden(false);
    await page.waitForTimeout(300);
    expect(await row.last().textContent()).toBe("4*");
    await expect(row).toHaveText(["0", "0", "0", "0", "0", "1", "1"], { timeout: 7000 });
  } finally {
    await page.close();
  }
});

const undoBase = '<div class="log" id="log_1" data-move-id="1"><div class="roundedbox">João lançou <div class="cat_log_token icon_die icon_die3"></div><div class="cat_log_token icon_die icon_die4"></div></div></div>'
  + '<div class="log" id="log_2" data-move-id="1"><div class="roundedbox">João ganha <span>2<div class="cat_log_token icon_lumber"></div>3<div class="cat_log_token icon_grain"></div></span></div></div>';
const undoTrade = '<div class="log" id="log_3" data-move-id="2"><div class="roundedbox">João negocia com o banco: <span>3<div class="cat_log_token icon_grain"></div></span> → <span><div class="cat_log_token icon_brick"></div></span></div></div>';
const undoBuild = '<div class="log" id="log_4" data-move-id="3"><div class="roundedbox">João constrói uma estrada por <span><div class="cat_log_token icon_lumber"></div><div class="cat_log_token icon_brick"></div></span></div></div>';
const rollback = (id, move) => `<div class="log" id="log_${id}" data-move-id="${move}"><div class="roundedbox">João retrocede</div></div>`
  + `<div class="log" id="log_${id + 1}" data-move-id="${move}"><div class="roundedbox">João desfaz a sua jogada</div></div>`;

test("retrocesso que alcança a sincronização invalida a mão anterior", async () => {
  const gain = '<div class="log" id="log_1" data-move-id="1"><div class="roundedbox">João ganha <span>4<div class="cat_log_token icon_lumber"></div></span></div></div>';
  const build = '<div class="log" id="log_2" data-move-id="2"><div class="roundedbox">João constrói uma estrada por <span><div class="cat_log_token icon_lumber"></div><div class="cat_log_token icon_brick"></div></span></div></div>';
  const page = await context.newPage();
  try {
    const { frame, state } = await table(page, "112", gain + build, "catan", { 1: 0, 2: 1, 3: 0 });
    const row = frame.locator("#cbv-resources table").first().locator("tbody tr").nth(1).locator("td");
    await expect(row).toHaveText(["0", "0", "0", "0", "0", "1", "1"], { timeout: 7000 });
    await frame.locator("#logs").evaluate((logs, html) => {
      logs.insertAdjacentHTML("beforeend", html);
      document.getElementById("cat_panel_score_resources_2").textContent = "4";
    }, rollback(3, 2));
    const restored = ["4", "0", "0", "0", "0", "0", "4"];
    await expect(row).toHaveText(restored);
    await page.waitForTimeout(350);
    state.history = gain + build + rollback(3, 2);
    state.totals = { 1: 0, 2: 4, 3: 0 };
    await page.reload();
    await expect(row).toHaveText(restored);
  } finally {
    await page.close();
  }
});

test("retrocesso remove todas as ações desfeitas, mesmo com logs antigos ainda visíveis", async () => {
  const page = await context.newPage();
  try {
    const { frame, state } = await table(page, "106", undoBase);
    await frame.getByRole("tab", { name: "Recursos", exact: true }).click();
    const row = frame.locator("#cbv-resources table").first().locator("tbody tr").nth(1).locator("td");
    const initial = ["2", "0", "0", "3", "0", "0", "5"];
    await expect(row).toHaveText(initial);
    await frame.locator("#logs").evaluate((logs, html) => {
      logs.insertAdjacentHTML("beforeend", html);
      document.getElementById("cat_panel_score_resources_2").textContent = "1";
    }, undoTrade + undoBuild);
    await expect(row).toHaveText(["1", "0", "0", "0", "0", "0", "1"]);

    await frame.locator("#logs").evaluate((logs, html) => {
      logs.insertAdjacentHTML("beforeend", html);
      document.getElementById("cat_panel_score_resources_2").textContent = "5";
    }, rollback(5, 2));
    await expect(row).toHaveText(initial);
    await expect(frame.locator("#cbv-dice .cbv-total")).toHaveText("1 rolagens contabilizadas");
    await frame.locator("#map_surface").evaluate((surface) => {
      surface.innerHTML = surface.querySelector("#cat_summary").outerHTML;
    });
    await expect(frame.locator("#cbv-panel")).toHaveCount(1);
    await expect(row).toHaveText(initial);

    const secondTrade = '<div class="log" id="log_7" data-move-id="3"><div class="roundedbox">João negocia com o banco: <span>3<div class="cat_log_token icon_grain"></div></span> → <span><div class="cat_log_token icon_wool"></div></span></div></div>';
    await frame.locator("#logs").evaluate((logs, html) => {
      logs.insertAdjacentHTML("beforeend", html);
      document.getElementById("cat_panel_score_resources_2").textContent = "3";
    }, secondTrade);
    await expect(row).toHaveText(["2", "0", "1", "0", "0", "0", "3"]);
    await frame.locator("#logs").evaluate((logs, html) => {
      logs.insertAdjacentHTML("beforeend", html);
      document.getElementById("cat_panel_score_resources_2").textContent = "5";
    }, rollback(8, 3));
    await expect(row).toHaveText(initial);

    const finalTrade = undoTrade.replace('id="log_3"', 'id="log_10"').replace('data-move-id="2"', 'data-move-id="4"');
    await frame.locator("#logs").evaluate((logs, html) => {
      logs.insertAdjacentHTML("beforeend", html);
      document.getElementById("cat_panel_score_resources_2").textContent = "3";
    }, finalTrade);
    const final = ["2", "1", "0", "0", "0", "0", "3"];
    await expect(row).toHaveText(final);
    await page.waitForTimeout(4500);
    await expect(row).toHaveText(final);
    await expect(frame.locator("#cbv-resources table").first().getByRole("columnheader", { name: "?", exact: true })).toHaveCount(1);

    state.history = undoBase + rollback(5, 2) + rollback(8, 3) + finalTrade;
    state.totals = { 1: 0, 2: 3, 3: 0 };
    await page.reload();
    await expect(row).toHaveText(final);
    await expect(frame.locator("#cbv-dice .cbv-total")).toHaveText("1 rolagens contabilizadas");
  } finally {
    await page.close();
  }
});

test("retrocesso preserva a rolagem e o roubo irreversível, removendo banco e construção", async () => {
  const page = await context.newPage();
  try {
    const bank = '<div class="log" id="log_3" data-move-id="3"><div class="roundedbox">João negocia com o banco: <span>3<div class="cat_log_token icon_grain"></div></span> → <span><div class="cat_log_token icon_brick"></div></span></div></div>';
    const build = '<div class="log" id="log_4" data-move-id="4"><div class="roundedbox">João constrói uma estrada por <span><div class="cat_log_token icon_lumber"></div><div class="cat_log_token icon_brick"></div></span></div></div>';
    const theft = '<div class="log" id="log_5" data-move-id="2"><div class="roundedbox">João rouba de Ana de Souza</div></div>';
    const { frame } = await table(page, "109", undoBase + theft + bank + build);
    await expect(frame.locator("#cbv-dice .cbv-total")).toHaveText("1 rolagens contabilizadas");
    await expect(frame.locator("#cbv-thefts .cbv-total")).toHaveText("1 roubos · 7 e cavaleiro");
    await frame.locator("#logs").evaluate((logs, html) => logs.insertAdjacentHTML("beforeend", html), rollback(6, 2));
    await expect(frame.locator("#cbv-dice .cbv-total")).toHaveText("1 rolagens contabilizadas");
    await expect(frame.locator("#cbv-thefts .cbv-total")).toHaveText("1 roubos · 7 e cavaleiro");
    await expect(frame.locator("#cbv-status")).not.toContainText("cache antigo");
  } finally {
    await page.close();
  }
});

test("recarregar corrige trocas desfeitas e preserva rolagens antigas", async () => {
  const page = await context.newPage();
  try {
    const oldRoll = '<div class="log" id="log_5" data-move-id="5"><div class="roundedbox">João lançou <div class="cat_log_token icon_die icon_die6"></div><div class="cat_log_token icon_die icon_die6"></div></div></div>';
    const { frame, state } = await table(page, "107", undoBase + undoTrade + undoBuild + oldRoll, "catan", { 1: 0, 2: 1, 3: 0 });
    const row = frame.locator("#cbv-resources table").first().locator("tbody tr").nth(1).locator("td");
    await expect(row).toHaveText(["1", "0", "0", "0", "0", "0", "1"]);
    await expect(frame.locator("#cbv-dice .cbv-total")).toHaveText("2 rolagens contabilizadas");
    await page.waitForTimeout(350);

    const validTrade = undoTrade.replace('id="log_3"', 'id="log_7"').replace('data-move-id="2"', 'data-move-id="3"');
    const validRoll = '<div class="log" id="log_8" data-move-id="4"><div class="roundedbox">João lançou <div class="cat_log_token icon_die icon_die1"></div><div class="cat_log_token icon_die icon_die2"></div></div></div>';
    state.history = undoBase + rollback(5, 2) + validTrade + validRoll;
    state.totals = { 1: 0, 2: 3, 3: 0 };
    await page.reload();
    const final = ["2", "1", "0", "0", "0", "0", "3"];
    await expect(row).toHaveText(final);
    await expect(frame.locator("#cbv-dice .cbv-total")).toHaveText("3 rolagens contabilizadas");
    await frame.getByRole("tab", { name: "Dados", exact: true }).click();
    await frame.locator("#cbv-dice-history-button").click();
    await expect(frame.locator("#cbv-roll-history .cbv-roll").first()).toHaveAttribute("title", "Rolagem 3: João tirou 6 + 6 = 12");
    await page.waitForTimeout(350);
    await page.reload();
    await expect(row).toHaveText(final);
    await expect(frame.locator("#cbv-dice .cbv-total")).toHaveText("3 rolagens contabilizadas");
  } finally {
    await page.close();
  }
});

test("avisa quando a BGA não identifica a jogada desfeita", async () => {
  const page = await context.newPage();
  try {
    const { frame } = await table(page, "108", undoBase);
    await frame.getByRole("tab", { name: "Recursos", exact: true }).click();
    await frame.locator("#logs").evaluate((logs) => {
      logs.insertAdjacentHTML("beforeend", '<div class="log" id="log_3"><div class="roundedbox">João retrocede</div></div>');
    });
    await expect(frame.locator("#cbv-status")).toContainText("Jogada desfeita sem identificação");
    await expect(frame.locator("#cbv-status")).toHaveClass(/cbv-error/);
  } finally {
    await page.close();
  }
});

test("outro jogo não ativa mesmo com elementos parecidos com Catan", async () => {
  const page = await context.newPage();
  try {
    const { frame } = await table(page, "103", rolls, "carcassonne");
    await expect(frame.locator("#cat_map")).toHaveCount(1);
    await expect(frame.locator("#cbv-panel")).toHaveCount(0);
    await expect(page.locator("#cbv-panel")).toHaveCount(0);
  } finally {
    await page.close();
  }
});

test("acompanha as dimensões nativas e mantém o mesmo espaço ao alternar abas", async () => {
  const page = await context.newPage();
  try {
    const { frame } = await table(page, "104");
    await expect(frame.locator("#cbv-panel")).toBeVisible();
    await expect(frame.locator("#cbv-panel")).toHaveCSS("width", "224px");
    const original = await frame.locator("#cbv-panel").boundingBox();
    for (const name of ["Dados", "Roubos", "Custos de construção"]) {
      await frame.getByRole("tab", { name, exact: true }).click();
      expect(await frame.locator("#cbv-panel").boundingBox()).toEqual(original);
    }
    await frame.locator("#cat_summary").evaluate((summary) => {
      summary.style.width = "210px";
      summary.style.height = "260px";
    });
    await expect(frame.locator("#cbv-panel")).toHaveCSS("width", "210px");
    await expect(frame.locator(".cbv-content")).toHaveCSS("height", "260px");
    await frame.locator("#game_play_area").evaluate((area) => { area.style.width = "480px"; });
    const bounds = await frame.locator("#cbv-panel").evaluate((panel) => {
      const rect = panel.getBoundingClientRect();
      const area = document.getElementById("map_surface").getBoundingClientRect();
      return { bottom: area.bottom - rect.bottom, right: area.right - rect.right, inside: rect.left >= area.left };
    });
    expect(bounds).toEqual({ bottom: 5, right: 5, inside: true });
  } finally {
    await page.close();
  }
});

test("preserva o nó original, seus eventos e atualizações enquanto outras abas estão abertas", async () => {
  const page = await context.newPage();
  try {
    const { frame } = await table(page, "105");
    await frame.getByRole("tab", { name: "Custos de construção" }).click();
    await expect(frame.locator("#cat_summary")).toBeVisible();
    const sameNode = await frame.locator("#cat_summary").evaluate((summary) => summary === window.originalSummary);
    expect(sameNode).toBe(true);
    await frame.getByRole("button", { name: "Estrada" }).click();
    await expect(frame.locator("#cat_summary")).toHaveAttribute("data-clicked", "true");
    await frame.getByRole("tab", { name: "Dados", exact: true }).click();
    await expect(frame.locator("#cat_summary")).toBeHidden();
    await frame.locator("#cat_summary_tr_content").evaluate((rates) => { rates.textContent = "2:1"; });
    await frame.locator("#logs").evaluate((logs) => {
      const theft = logs.querySelector("#log_3").cloneNode(true);
      theft.id = "log_6";
      theft.setAttribute("data-move-id", "6");
      logs.prepend(theft);
    });
    await expect(frame.locator("#cbv-thefts .cbv-total")).toHaveText("3 roubos · 7 e cavaleiro");
    await frame.getByRole("tab", { name: "Roubos", exact: true }).click();
    await expect(frame.getByRole("tabpanel", { name: "Roubos" })).toBeVisible();
    await expect(frame.locator("#cbv-thefts tbody tr").nth(0).locator("td")).toHaveText(["2", "1"]);
    await frame.getByRole("tab", { name: "Custos de construção" }).click();
    await expect(frame.locator("#cat_summary")).toBeVisible();
    await expect(frame.locator("#cat_summary_tr_content")).toHaveText("2:1");
    await expect(frame.locator("#cat_summary")).toHaveCount(1);
  } finally {
    await page.close();
  }
});
