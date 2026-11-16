const { test, expect, chromium } = require("@playwright/test");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");

let context;
let profile;
const root = path.resolve(__dirname, "..");
const rolls = '<div class="log" id="log_1" data-move-id="1">Ana de Souza lançou <div class="icon_die icon_die3"></div><div class="icon_die icon_die4"></div></div>'
  + '<div class="log" id="log_2" data-move-id="2">João lançou <div class="icon_die icon_die6"></div><div class="icon_die icon_die6"></div></div>';
const thefts = '<div class="log" id="log_3" data-move-id="3">Ana de Souza rouba de João</div>'
  + '<div class="log" id="log_4" data-move-id="4">João joga um cavaleiro</div>'
  + '<div class="log" id="log_5" data-move-id="5">João rouba de Ana de Souza</div>';

function fixture(logs) {
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0}
    #cat_summary{position:absolute;right:5px;bottom:5px;width:224px;height:240px;background:#f0e2b1}
    </style>
    <div id="game_play_area" style="position:relative;width:1000px">
      <div id="map_container" style="position:relative;height:740px;background:#1689bb">
        <div id="cat_map"></div>
        <div id="map_surface" style="position:absolute;inset:0">
          <div id="cat_summary">
            <div id="cat_summary_title">CUSTOS DE CONSTRUÇÃO</div>
            <button id="cat_summary_road" type="button">Estrada</button>
            <div id="cat_summary_costs_road">Madeira + Tijolo</div>
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
    <div id="logs">${logs}</div>
    <script>
      window.originalSummary = document.getElementById("cat_summary");
      document.getElementById("cat_summary_road").addEventListener("click", () => {
        window.originalSummary.dataset.clicked = "true";
      });
    </script>`;
}

async function table(page, id, history = rolls + thefts, game = "catan") {
  const state = { history };
  await page.route("https://boardgamearena.com/**", (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname === "/tableview"
      ? `<iframe id="gameIframe" width="1100" height="900" src="/11/${game}?table=${url.searchParams.get("table")}"></iframe>`
      : fixture(state.history);
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

test("extensão real no iframe: custos como primeira aba, contagens e posição original à direita", async () => {
  const page = await context.newPage();
  try {
    const { frame } = await table(page, "101");
    await expect(frame.getByRole("tab")).toHaveText(["Custos", "Dados", "Histórico", "Roubos"]);
    await expect(frame.getByRole("tab", { name: "Custos de construção" })).toHaveAttribute("aria-selected", "true");
    await expect(frame.locator("#cat_summary")).toBeVisible();
    await expect(frame.locator("#cbv-status")).toBeHidden();
    await expect(frame.locator("#cbv-toggle, .cbv-hide")).toHaveCount(0);
    await expect(frame.locator("#cbv-dice .cbv-total")).toHaveText("2 rolagens contabilizadas");
    await expect(page.locator("#cbv-panel")).toHaveCount(0);
    await frame.getByRole("tab", { name: "Roubos", exact: true }).click();
    await expect(frame.getByRole("tabpanel", { name: "Roubos" })).toBeVisible();
    await expect(frame.locator("#cbv-thefts .cbv-total")).toHaveText("2 roubos · 7 e cavaleiro");
    await expect(frame.locator("#cbv-thefts tbody tr").nth(0).locator("td")).toHaveText(["1", "1"]);
    await expect(frame.locator("#cbv-thefts tbody tr").nth(1).locator("td")).toHaveText(["1", "1"]);
    await expect(frame.locator("#cbv-thefts tbody tr").nth(2).locator("td")).toHaveText(["0", "0"]);
    await frame.getByRole("tab", { name: "Roubos", exact: true }).press("ArrowLeft");
    await expect(frame.getByRole("tab", { name: "Histórico", exact: true })).toBeFocused();
    const history = frame.locator("#cbv-history .cbv-roll");
    await expect(history).toHaveCount(2);
    await expect(history.nth(0)).toHaveAttribute("title", "Rolagem 2: João tirou 6 + 6 = 12");
    await expect(history.nth(0)).toHaveClass(/cbv-latest/);
    await expect(history.nth(1)).toHaveAttribute("title", "Rolagem 1: Ana de Souza tirou 3 + 4 = 7");
    await expect(history.nth(1).locator(".cbv-sum")).toHaveClass(/cbv-seven/);
    await expect(history.nth(0).locator(".cbv-die").nth(0).locator(".cbv-pip")).toHaveCount(6);
    await expect(history.nth(1).locator(".cbv-die").nth(1).locator(".cbv-pip")).toHaveCount(4);
    expect(await frame.locator(".cbv-tabs button").evaluateAll((tabs) =>
      tabs.filter((tab) => tab.scrollWidth > tab.clientWidth).map((tab) => tab.textContent))).toEqual([]);
    await frame.getByRole("tab", { name: "Histórico", exact: true }).press("ArrowLeft");
    await expect(frame.getByRole("tab", { name: "Dados", exact: true })).toBeFocused();
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
    await expect(frame.getByRole("tab", { name: "Custos de construção" })).toBeFocused();
    await expect(frame.locator("#cat_summary")).toBeVisible();
    await frame.getByRole("tab", { name: "Custos de construção" }).press("ArrowLeft");
    await expect(frame.getByRole("tab", { name: "Roubos", exact: true })).toBeFocused();
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
