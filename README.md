# Catan BGA Viewer

Extensão Manifest V3 para Chrome e Edge, sem dependências de execução.
Transforma o quadro **Custos de construção**, no canto inferior direito da área azul
do mapa, em um painel com quatro abas e visual de pergaminho:

- **Recursos:**
  - *Mão estimada:* quantas cartas de cada recurso cada jogador provavelmente tem agora,
    reconstruído pelos logs: produção, trocas com o banco e entre jogadores, construções,
    cartas de desenvolvimento, descartes do 7 e monopólio. O total de cada jogador vem
    do contador público do painel da BGA (o Σ sempre bate; `*` avisa se não bater).
    Como a BGA só atualiza esse contador depois da animação de trocas e roubos (e as
    animações param com a aba em segundo plano), a extensão mantém a estimativa já
    assentada e só a corrige pelo contador se os dois discordarem por ~4 s com a aba visível.
    Quem assiste não vê qual carta foi roubada: cada roubo abre as possibilidades
    conforme a mão da vítima (uma carta comum na mão é mais provável), e gastos, trocas
    e "não tem" do monopólio posteriores descartam as possibilidades impossíveis. Para o
    ladrão ou a vítima, o aviso privado "Você recebe/perde …" revela a carta.
    - Os valores por recurso mostram somente o mínimo entre os cenários coerentes considerados.
      Células destacadas podem ter mais; passe o mouse para ver o máximo e a média estimada.
    - `?` (sempre visível, inclusive como `0`): cartas restantes sem recurso garantido,
      calculadas como total da mão menos a soma dos mínimos por recurso. Inclui cartas
      anteriores aos logs e resultados de roubos ocultos. O `Σ` continua sendo o total de cartas,
      não uma margem de erro.
  - *Potencial no tabuleiro:* para cada jogador, soma das chances (em 36) de cada recurso
    nos hexágonos vizinhos às suas construções, lido do tabuleiro atual: aldeia vale 1×,
    cidade 2× (ex.: 6 e 8 valem 5/36, 2 e 12 valem 1/36). O hexágono sob o ladrão
    continua somando, mas o recurso afetado aparece em vermelho.
  - *Produção recebida:* recursos que cada jogador ganhou pelas rolagens, lidos dos logs
    "X ganha …", para ver onde cada um rendeu mais ao longo da partida.
  - *Histórico de recursos:* o botão no topo alterna a visualização geral e o histórico
    (recebimentos, gastos, trocas e recursos identificados em roubos), do mais recente ao mais antigo.
- **Dados:** frequência das somas de 2 a 12 em barras horizontais empilhadas na vertical,
  com a contagem dentro da barra, alinhada ao fim dela; total de rolagens e percentual ao passar o mouse.
  O botão no topo alterna a distribuição e o histórico de rolagens, exibido do mais recente ao mais antigo, com jogador, dados
  (brancos com pontos pretos, desenhados em SVG) e soma (7 em vermelho). Rolagens salvas por
  versões anteriores aparecem com dados "?" até serem relidas dos logs.
- **Roubos:** roubos feitos e sofridos por jogador, somando os provocados por 7 e por cavaleiro.
  O botão no topo alterna a tabela de roubos e o histórico de quem roubou de quem, do mais recente ao mais antigo.
- **Custos:** mantém o quadro original do jogo, incluindo ícones, indicação de recursos e taxas de troca atualizados pela BGA.

Não há botão de ocultar nem bolinha flutuante. As contagens continuam sendo
atualizadas em segundo plano enquanto outra aba está aberta.

## Instalação

1. Abra `chrome://extensions` ou `edge://extensions`.
2. Ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione esta pasta (a que contém `manifest.json`).
4. Recarregue a mesa em `https://boardgamearena.com/tableview?table=...`.

Não é necessário executar npm ou um servidor. Depois de alterar os arquivos, clique em
**Atualizar** no cartão da extensão e recarregue a mesa.

## Funcionamento e limites

- Ativa somente em uma URL de mesa de **Catan**, inclusive no iframe `/11/catan?table=...`
  usado pelo `tableview`, nos subdomínios de idioma da BGA.
- Lê apenas o DOM dos logs já disponibilizados pelo site. Não joga, não consulta dados
  privados do jogo nem envia informações a servidores externos.
- Reconhece os ícones reais `icon_die1` a `icon_die6` e mensagens de roubo em português
  e inglês. Outros idiomas não são suportados para roubos nesta versão.
- O contador representa **eventos de roubo**, não um inventário de recursos adversários.
  Ativar o ladrão, descartar recursos ou jogar cavaleiro sem roubar não conta como roubo.
- Salva os eventos localmente por número de mesa e usa `data-move-id` para não duplicar
  ao recarregar. Os dados ficam no navegador, não são sincronizados entre dispositivos.
  Logs sem identificador de jogada só são contabilizados na sessão atual.
- Ao instalar no meio de uma partida, só pode recuperar os logs carregados pelo site
  e os eventos salvos anteriormente pela extensão. Se a BGA oferecer carregar logs
  antigos, eles serão incorporados automaticamente quando aparecerem no DOM.
  O painel não afirma ter um histórico completo.
- Mantém a posição e acompanha as dimensões do quadro original de custos, também
  como espectador. As abas ficam acima dele; dados, histórico, roubos e recursos usam o mesmo espaço.
- A produção depende dos logs disponíveis (mesmo limite das demais abas); o potencial é
  recalculado a cada mudança e reflete apenas o tabuleiro atual.
- A mão estimada só usa um trecho contínuo de logs: se a mesa ficou sem acompanhamento
  e faltam jogadas entre a última visita e os logs carregados, ela recomeça desses logs
  e trata as cartas anteriores como `?`. É um palpite: um log não reconhecido ou
  expansões (Cidades e Cavaleiros, Navegadores) podem desviar o resultado.
- Ao identificar um retrocesso, remove apenas construções e trocas com o banco do jogador
  que foram desfeitas. Rolagens, roubos, cartas de desenvolvimento e trocas entre jogadores
  são preservados. Se o cache antigo não informar se um gasto/troca era reversível, a mão
  estimada reinicia com os totais atuais da BGA; as demais estatísticas continuam no histórico.
  Retrocessos antigos só podem ser corrigidos quando seu aviso ainda está nos logs carregados.
- Não há suporte a navegação de replay nesta versão.
- Para apagar o histórico local, remova a extensão.

## Desenvolvimento

Requer Node.js 18+ apenas para validação:

```text
npm ci
npx playwright install chromium
npm test
npm run check
```

Os testes cobrem detecção de Catan, leitura de dados, roubos, gastos e trocas, a mão
estimada (roubos ocultos, revelações, cartas anteriores ao registro), contagem por jogador,
retrocesso de jogadas, validação do cache e deduplicação após recarregar. Os testes de navegador carregam a
extensão real no Chromium, com páginas simuladas localmente: validam o iframe, as abas,
novos logs, o armazenamento do Chrome, isolamento entre mesas, as quatro abas, o histórico de rolagens,
preservação do quadro original e acompanhamento das dimensões do jogo.
Não acessam mesas reais nem precisam de login. A interface também foi verificada
em uma mesa de Catan como espectador, sem realizar ações na partida.
