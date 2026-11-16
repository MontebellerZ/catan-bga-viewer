const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isCatanUrl, readLog, summarize, validEvent, rollHistory } = require("../stats.js");

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
