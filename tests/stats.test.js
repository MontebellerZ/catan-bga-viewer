const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  isCatanUrl, readLog, readSetupActor, summarize, validEvent, rollHistory, theftHistory, resourceHistory, handEstimate, potential, pips
} = require("../stats.js");

const players = [
  { id: "1", name: "Ana de Souza" },
  { id: "2", name: "João" },
  { id: "3", name: "Jo" }
];

function log(textContent, faces = [], move = "42", id = "log_1", extra = "") {
  return {
    textContent: textContent + extra, id,
    getAttribute: () => move,
    querySelector: (selector) => (selector === ".roundedbox" ? { textContent } : null),
    querySelectorAll: () => faces.map((face) => ({ classList: ["cat_log_token", "icon_die", `icon_die${face}`] }))
  };
}

test("ativa apenas nos frames de mesas Catan em domínios BGA", () => {
  for (const url of ["https://boardgamearena.com/11/catan?table=123", "https://pt.boardgamearena.com/2/catan?table=123"]) {
    assert.equal(isCatanUrl(url), true);
  }
  for (const url of [
    "https://boardgamearena.com/tableview?table=123",
    "https://boardgamearena.com/11/carcassonne?table=123",
    "https://boardgamearena.com/gamepanel?game=catan",
    "https://boardgamearena.com.evil.example/11/catan?table=123",
    "https://boardgamearena.com/11/catan?table=abc"
  ]) assert.equal(isCatanUrl(url), false);
});

test("histórico guarda faces e jogador, ordenado pelo número da jogada", () => {
  const late = readLog(log("Jo lançou", [6, 5], "120"), players);
  const early = readLog(log("Ana de Souza lançou", [2, 3], "9"), players);
  assert.deepEqual([late.faces, late.actor, early.actor], [[6, 5], "3", "1"]);
  const theft = readLog(log("Jo rouba de Ana de Souza", [], "50"), players);
  assert.deepEqual(rollHistory([late, theft, early]), [early, late]);
  assert.equal(validEvent({ key: "move:1:roll", persistent: true, type: "roll", total: 8 }), true);
  assert.equal(validEvent({ ...early, faces: [1, 1] }), false);
});

test("conta somente resultados com dois dados, incluindo somas extremas e sete", () => {
  const events = [[1, 1], [6, 6], [3, 4]].map((faces, index) => readLog(log("lançou", faces, String(index)), players));
  const summary = summarize(events, players);
  assert.equal(summary.rolls, 3);
  for (const total of [2, 7, 12]) assert.equal(summary.dice[total], 1);
  assert.equal(readLog(log("João rola os dados..."), players), null);
  assert.equal(readLog(log("lançou", [4]), players), null);
  assert.equal(readLog(log("lançou", [0, 7]), players), null);
});

test("interpreta roubos em português e inglês com nomes compostos sem confundir prefixos", () => {
  for (const text of [
    "João rouba de Ana de Souza", "João roubou de Ana de Souza",
    "João steals from Ana de Souza", "João steals 1 resource from Ana de Souza"
  ]) {
    const event = readLog(log(text), players);
    assert.equal(event.actor, "2");
    assert.equal(event.victim, "1");
    assert.equal(event.type, "theft");
  }
  for (const text of ["Você perde", "João move o Ladrão", "João joga um cavaleiro", "João não rouba de Ana de Souza"]) {
    assert.equal(readLog(log(text), players), null);
  }
});

test("ignora horário e botão de replay que a BGA adiciona fora da mensagem do roubo", () => {
  const event = readLog(log("João rouba de Ana de Souza", [], "79", "log_162", "10:51 Replay a partir desta jogada"), players);
  assert.equal(event.actor, "2");
  assert.equal(event.victim, "1");
});

test("reconhece o retrocesso de Catan em português e inglês", () => {
  for (const text of ["João retrocede", "João desfaz a sua jogada", "João roll backs", "João rolls back"]) {
    const event = readLog(log(text, [], "67"), players);
    assert.deepEqual([event.type, event.actor, event.key], ["rollback", "2", "move:67:rollback:2"]);
    assert.equal(validEvent(event), true);
  }
});

test("identifica a aldeia inicial sem confundir estrada, construção paga ou nomes prefixados", () => {
  for (const action of ["coloca uma aldeia", "places a settlement"]) {
    assert.equal(readSetupActor(log(`João ${action}`), players), "2");
    assert.equal(readSetupActor(log(`Jo ${action}`), players), "3");
  }
  for (const action of ["coloca uma estrada", "constrói uma aldeia por", "ganha", "lançou"]) {
    assert.equal(readSetupActor(log(`João ${action}`), players), undefined);
  }
});

test("deduplica por jogada mesmo quando o ID visual muda; preserva rolagens iguais em jogadas diferentes", () => {
  const events = new Map();
  for (const [move, id] of [["1", "log_1"], ["1", "log_99"], ["2", "log_2"]]) {
    const event = readLog(log("lançou", [3, 4], move, id), players);
    events.set(event.key, event);
  }
  const restored = JSON.parse(JSON.stringify([...events.values()]));
  assert.equal(restored.every(validEvent), true);
  assert.equal(summarize(restored, players).dice[7], 2);
});

test("soma feitos e sofridos por jogador e mantém jogadores sem roubos", () => {
  const events = [
    readLog(log("João rouba de Ana de Souza", [], "1"), players),
    readLog(log("João rouba de Ana de Souza", [], "2"), players),
    readLog(log("Ana de Souza rouba de João", [], "3"), players)
  ];
  const summary = summarize(events, players);
  assert.equal(summary.robberies, 3);
  assert.deepEqual(summary.players.map(({ made, suffered }) => [made, suffered]), [[1, 2], [2, 1], [0, 0]]);
});

test("não persiste IDs visuais instáveis e rejeita dados salvos inválidos", () => {
  assert.equal(readLog(log("lançou", [1, 2], null), players).persistent, false);
  for (const event of [null, {}, { key: "x", persistent: true, type: "roll", total: 13 }]) {
    assert.equal(Boolean(validEvent(event)), false);
  }
});

function gainLog(textContent, tokens, move = "60") {
  return {
    ...log(textContent, [], move),
    querySelectorAll: () => tokens.map(([resource, before]) => ({
      classList: ["cat_log_token", `icon_${resource}`],
      previousSibling: before === undefined ? null : { textContent: before }
    }))
  };
}

test("produção: lê quantidades dos ícones, assume 1 sem número e ignora 'não ganha nada' e trocas", () => {
  const gain = readLog(gainLog("João ganha 2 1", [["lumber", "2"], ["ore", "1"], ["grain"]]), players);
  assert.deepEqual([gain.type, gain.actor, gain.resources], ["gain", "2", { lumber: 2, ore: 1, grain: 1 }]);
  assert.equal(validEvent(JSON.parse(JSON.stringify(gain))), true);
  assert.equal(validEvent({ ...gain, resources: { gold: 1 } }), false);
  assert.equal(readLog(gainLog("João não ganha nada", []), players), null);
  assert.equal(readLog(gainLog("João negocia com o banco: 4 → 1", [["brick", "4"], ["wool", "1"]]), players), null);
  const other = readLog(gainLog("Ana de Souza ganha", [["lumber"]], "61"), players);
  const summary = summarize([gain, other, readLog(log("João rouba de Ana de Souza", [], "62"), players)], players);
  assert.deepEqual(summary.players.map((player) => player.gains.lumber), [1, 2, 0]);
  assert.equal(summary.robberies, 1);
});

test("potencial: soma pips dos hexágonos vizinhos, cidade vale dobro e marca o que está sob o ladrão", () => {
  assert.deepEqual([2, 6, 7, 8, 12, undefined].map(pips), [1, 5, 0, 5, 1, 0]);
  const hexes = [
    { x: 0, y: 0, radius: 70, resource: "ore", number: 6 },
    { x: 120, y: 0, radius: 70, resource: "grain", number: 9, robber: true },
    { x: 60, y: 104, radius: 70, resource: "brick", number: 3 },
    { x: 400, y: 0, radius: 70, resource: "wool", number: 8 },
    { x: 240, y: 0, radius: 70, resource: null, number: null, robber: false }
  ];
  const buildings = [
    { x: 60, y: 35, owner: "1", level: 2 },
    { x: 400, y: 70, owner: "2", level: 1 },
    { x: 999, y: 999, owner: "3", level: 1 }
  ];
  const [ana, joao, jo] = potential({ hexes, buildings }, players);
  assert.deepEqual([ana.pips.ore, ana.pips.brick, ana.pips.grain, ana.total], [10, 4, 8, 22]);
  assert.deepEqual([ana.robbed.grain, ana.robbed.ore, ana.robbed.brick], [8, 0, 0]);
  assert.deepEqual([joao.pips.wool, joao.total, joao.robbed.wool], [5, 5, 0]);
  assert.deepEqual([jo.total, jo.robbed.grain], [0, 0]);
});

// Each inner array is one <span> of tokens, like the two sides of "A → B" in a trade log.
function cardsLog(textContent, groups, move = "70", id = "log_1") {
  return {
    ...log(textContent, [], move, id),
    querySelectorAll: () => groups.flatMap((group) => {
      const parent = {};
      return group.map(([resource, before]) => ({
        classList: ["cat_log_token", `icon_${resource}`],
        previousSibling: before === undefined ? null : { textContent: before },
        parentElement: parent
      }));
    })
  };
}

const at = (move, text, groups = [], id) => readLog(cardsLog(text, groups, String(move), id), players);

test("lê gastos, descartes, monopólio, trocas com banco e jogadores e a carta revelada em privado", () => {
  for (const [text, reversible, category] of [["Jo constrói uma estrada por", true, "build"], ["Jo descarta", false, "discard"],
    ["Jo perde", false, "loss"], ["Jo compra uma carta de desenvolvimento por", false, "development"],
    ["Jo melhorou a Aldeia para uma Cidade por", true, "build"]]) {
    const event = at(1, text, [[["lumber"], ["brick", "2"]]]);
    assert.deepEqual([event.type, event.actor, event.resources, event.reversible, event.category],
      ["spend", "3", { lumber: 1, brick: 2 }, reversible, category]);
  }
  const road = at(1, "Jo constrói uma estrada por", [[["lumber"]]]);
  assert.equal(road.label, "construiu uma estrada");
  assert.equal(validEvent(road), true);
  assert.equal(validEvent({ ...road, label: 1 }), false);
  assert.equal(at(1, "Jo melhorou a Aldeia para uma Cidade por", [[["lumber"]]]).label, "melhorou a aldeia para uma cidade");
  assert.equal(at(1, "Jo builds a road for", [[["lumber"]]]).label, "construiu a road");
  const bank = at(2, "João negocia com o banco: 4 → 1", [[["ore", "4"]], [["wool"]]]);
  assert.deepEqual([bank.type, bank.actor, bank.partner, bank.gives, bank.gets, bank.reversible],
    ["trade", "2", null, { ore: 4 }, { wool: 1 }, true]);
  const trade = at(3, "⇌ João dá 1 a Ana de Souza que dá 2 em troca", [[["ore"]], [["grain", "2"]]]);
  assert.deepEqual([trade.actor, trade.partner, trade.gives, trade.gets, trade.reversible],
    ["2", "1", { ore: 1 }, { grain: 2 }, false]);
  const lacks = at(4, "Ana de Souza não tem", [[["grain"]]]);
  assert.deepEqual([lacks.type, lacks.actor, lacks.resources], ["lacks", "1", { grain: 1 }]);
  const reveal = at(5, "Você recebe", [[["wool"]]]);
  assert.deepEqual([reveal.type, reveal.direction, reveal.resources], ["reveal", "gain", { wool: 1 }]);
  assert.equal(at(6, "João oferece uma troca: →", [[["ore"]], [["wool"]]]), null);
  assert.equal(at(6, "João está procurando por", [[["ore"]]]), null);

  const theft = readLog(log("João rouba de Ana de Souza", [], "7"), players);
  const events = [bank, trade, lacks, reveal, theft];
  assert.equal(JSON.parse(JSON.stringify(events)).every(validEvent), true);
  assert.equal(validEvent({ ...bank, reversible: undefined }), true);
  assert.equal(validEvent({ ...bank, reversible: "sim" }), false);
  for (const broken of [{ ...trade, partner: "2" }, { ...reveal, direction: "x" }, { ...lacks, type: "other" }, { ...theft, seq: -1 }]) {
    assert.equal(validEvent(broken), false);
  }
  assert.equal(summarize(events, players).robberies, 1);
});

test("separa cronologicamente históricos de roubos e movimentações de recursos", () => {
  const roll = readLog(log("João lançou", [3, 4], "1"), players);
  const theft = readLog(log("João rouba de Ana de Souza", [], "2"), players);
  const gain = at(3, "João ganha", [[["ore", "2"]]]);
  const spend = at(4, "João constrói uma estrada por", [[["lumber"], ["brick"]]]);
  const trade = at(5, "João negocia com o banco: 4 → 1", [[["ore", "4"]], [["wool"]]]);
  const reveal = at(6, "Você recebe", [[["wool"]]]);
  const clue = at(7, "Ana de Souza não tem", [[["grain"]]]);
  const events = [roll, theft, gain, spend, trade, reveal, clue];

  assert.deepEqual(theftHistory([...events].reverse()), [theft]);
  assert.deepEqual(resourceHistory([...events].reverse()), [gain, spend, trade, reveal]);
});

test("mão estimada: mostra mínimos garantidos e descarta cenários contraditos por gastos posteriores", () => {
  const events = [
    at(1, "Ana de Souza ganha", [[["lumber"], ["brick"]]]),
    at(2, "João ganha", [[["ore", "4"]]]),
    at(3, "João negocia com o banco: 4 → 1", [[["ore", "4"]], [["lumber"]]]),
    readLog(log("João rouba de Ana de Souza", [], "4"), players)
  ];
  let [ana, joao, jo] = handEstimate(events, players);
  assert.deepEqual([ana.hand.lumber, ana.hand.brick, ana.total, ana.unassigned, ana.range.lumber, ana.range.brick],
    [0, 0, 1, 1, [0, 1], [0, 1]]);
  assert.deepEqual([joao.hand.lumber, joao.total, joao.unassigned, joao.range.lumber, joao.thefts],
    [1, 2, 1, [1, 2], { made: 1, suffered: 0, hidden: 1 }]);
  assert.deepEqual([jo.total, jo.unassigned], [0, 0]);

  events.push(at(5, "João constrói uma estrada por", [[["lumber"], ["brick"]]]));
  [ana, joao] = handEstimate(events, players);
  assert.deepEqual([ana.hand, ana.unassigned], [{ lumber: 1, brick: 0, wool: 0, grain: 0, ore: 0 }, 0]);
  assert.deepEqual([joao.total, joao.unassigned], [0, 0]);
});

test("mão estimada: cartas anteriores ao registro vêm do total da BGA; revelação, trocas e 'não tem' resolvem roubos", () => {
  const events = [
    at(1, "Jo ganha", [[["ore", "5"]]]),
    at(5, "Ana de Souza ganha", [[["wool"], ["grain"]]]),
    readLog(log("Jo rouba de Ana de Souza", [], "6"), players),
    { ...at(6, "Você recebe", [[["grain"]]], "log_2"), seq: 1 },
    at(7, "⇌ Jo dá 1 a Ana de Souza que dá 1 em troca", [[["grain"]], [["wool"]]]),
    at(8, "Jo compra uma carta de desenvolvimento por", [[["wool"], ["grain"], ["ore"]]])
  ];
  const [ana, joao, jo] = handEstimate(events, players, { from: 5, totals: { 1: 1, 2: 0, 3: 1 } });
  assert.deepEqual([ana.hand.grain, ana.total, ana.unassigned, ana.consistent], [1, 1, 0, true]);
  assert.equal(joao.total, 0);
  // Jo started the record with 3 unseen cards and paid grain + ore with two of them.
  assert.deepEqual([jo.unknown, jo.total, jo.unassigned, jo.thefts.hidden, jo.consistent], [1, 1, 1, 0, true]);
  assert.equal(handEstimate(events, players, { from: 5, totals: { 1: 0 } })[0].consistent, false);
  // While BGA's panel still shows the count from before an animation, the previous start counts win.
  const lagging = handEstimate(events, players, { from: 5, totals: { 3: 4 }, start: { 3: jo.initial } })[2];
  assert.deepEqual([jo.initial, lagging.unknown, lagging.total], [3, 1, 1]);

  const monopoly = [
    at(1, "Ana de Souza ganha", [[["wool"], ["grain"]]]),
    readLog(log("Jo rouba de Ana de Souza", [], "2"), players),
    at(3, "Ana de Souza não tem", [[["grain"]]])
  ];
  const [victim, , thief] = handEstimate(monopoly, players);
  assert.deepEqual([victim.hand.wool, victim.unassigned, thief.hand.grain, thief.unassigned], [1, 0, 1, 0]);
});

test("mão estimada: não oculta um recurso possível só por ter baixa probabilidade", () => {
  const events = [
    at(1, "Ana de Souza ganha", [[["lumber", "99"], ["grain"]]]),
    readLog(log("João rouba de Ana de Souza", [], "2"), players)
  ];
  const [ana] = handEstimate(events, players);
  assert.deepEqual([ana.hand.lumber, ana.hand.grain, ana.range.grain, ana.unassigned, ana.total],
    [98, 0, [0, 1], 1, 99]);
});

test("mão sincronizada preserva recursos garantidos e aplica roubos e gastos posteriores", () => {
  const initialHands = {
    1: { resources: { lumber: 1, brick: 1, wool: 0, grain: 0, ore: 0 }, unknown: 0 },
    3: { resources: { lumber: 0, brick: 0, wool: 0, grain: 1, ore: 0 }, unknown: 2 }
  };
  const events = [
    readLog(log("João rouba de Ana de Souza", [], "2"), players),
    at(3, "João descarta", [[["brick"]]])
  ];
  const [ana, joao, jo] = handEstimate(events, players, { initialHands });
  assert.deepEqual([ana.hand.lumber, ana.hand.brick, ana.unassigned, ana.total], [1, 0, 0, 1]);
  assert.deepEqual([joao.total, joao.unassigned], [0, 0]);
  assert.deepEqual([jo.hand.grain, jo.unknown, jo.unassigned, jo.total], [1, 2, 2, 3]);
});
