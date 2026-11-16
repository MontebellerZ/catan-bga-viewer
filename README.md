# Catan BGA Viewer

Extensão Manifest V3 para Chrome e Edge, sem dependências de execução.
Transforma o quadro **Custos de construção**, no canto inferior direito da área azul
do mapa, em um painel com quatro abas e visual de pergaminho:

- **Custos:** primeira aba, aberta inicialmente, mantém o quadro original do jogo,
  incluindo ícones, indicação de recursos e taxas de troca atualizados pela BGA.
- **Dados:** frequência das somas de 2 a 12 em barras horizontais empilhadas na vertical,
  com a contagem dentro da barra, alinhada ao fim dela; total de rolagens e percentual ao passar o mouse.
- **Histórico:** lista das rolagens, a mais recente primeiro, com número da rolagem, jogador,
  os dois dados (brancos com pontos pretos, desenhados em SVG) e a soma (7 em vermelho). Rolagens salvas por versões anteriores
  aparecem com dados "?" até serem relidas dos logs.
- **Roubos:** roubos feitos e sofridos por jogador, somando os provocados por 7 e por cavaleiro.

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
  como espectador. As abas ficam acima dele; dados, histórico e roubos usam o mesmo espaço.
- Não há recuperação de jogadas desfeitas nem suporte a navegação de replay nesta versão.
- Para apagar o histórico local, remova a extensão.

## Desenvolvimento

Requer Node.js 18+ apenas para validação:

```text
npm ci
npx playwright install chromium
npm test
npm run check
```

Os testes cobrem detecção de Catan, leitura de dados e roubos, contagem por jogador,
validação do cache e deduplicação após recarregar. Os testes de navegador carregam a
extensão real no Chromium, com páginas simuladas localmente: validam o iframe, as abas,
novos logs, o armazenamento do Chrome, isolamento entre mesas, as quatro abas, o histórico de rolagens,
preservação do quadro original e acompanhamento das dimensões do jogo.
Não acessam mesas reais nem precisam de login. A interface também foi verificada
em uma mesa de Catan como espectador, sem realizar ações na partida.
