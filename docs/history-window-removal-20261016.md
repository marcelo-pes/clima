# Remoção da barra de período — clima e clima2

Removido o elemento `history-window` do contêiner compartilhado entre as seis
abas, incluindo seu espaço no layout. A regra CSS agora atende somente
`section-loading`. Gráficos, filtros, dados e marcadores de mínimo/máximo
permanecem no mesmo código.

## Fonte publicada e versionamento

Em 16/10/2026, os dois domínios públicos serviam o frontend de
`/root/CLIMA/Clima2/app`. O componente publicado tem funcionalidades que
a fonte atual de `main` ainda não contém. Essa fonte de `main` já não contém
`history-window`; substituir a produção por ela removeria funcionalidades
fora do pedido.

Por isso, `deploy/remove-history-window.patch` registra a alteração exata do
componente publicado, e `scripts/remove-history-window.py` aplica a remoção
na fonte publicada, na cópia de fonte do checkout da VPS e nos artefatos
existentes. Não é usado CSS para esconder o elemento. O nó JSX é removido,
assim como a expressão que o cria nos bundles. Os nomes dos arquivos recebem
um sufixo para invalidar o cache. Arquivos antigos são preservados e recebem
a mesma remoção, para não reintroduzir a barra por referências antigas.

O script valida os dois serviços antes de escrever, faz backup dos arquivos
afetados e restaura o serviço em caso de falha na publicação. Sem `--apply`,
somente relata as alterações planejadas. Reexecução após a remoção não produz
novas alterações.

## Publicação e verificações

- Backup: `/root/CLIMA/Clima2/backups/remove-history-window-20261016T174452Z`.
- Serviço original: nenhuma alteração necessária; não continha a barra.
- Clima2: 95 arquivos existentes conferidos contra o backup; diferenças
  restritas à remoção da barra, seletor CSS e referências de cache.
- JavaScript alterado validado com `node --check` antes do reinício.
- Fonte TSX resultante validada pelo parser TypeScript; preservados os trechos
  de `ReferenceDot`, `extremaOfPoints`, `plotData` e controles de filtros.
- Teste `node --test scripts/history-completeness.test.mjs` aprovado.
- Ambas as páginas e APIs públicas responderam HTTP 200; APIs mantiveram
  30 métricas e leituras atuais.
- Bundle público nos dois domínios:
  `weather-dashboard-DocoZMA7-wc4584593861-no-ecowitt-IBAURU19-footer20261015-no-history-window20261016.js`.
- SHA256 do bundle: `ba969487f00dbba0c37cfabd2727c0045f9fa2d669e281606530231dc7f4826c`.

Não foi executado um build completo da fonte antiga de `main`; a publicação
preservou os artefatos funcionais existentes. Banco, coleta, credenciais,
rotas e configuração dos domínios não foram alterados.

## Navegador

Verificadas Dados Atuais, Previsão, Satélite, Ventos, Histórico e Perfil nos
dois domínios em 1440 px e 390 px: 24 combinações, todas sem `history-window`.
Gráficos e marcadores presentes: Dados Atuais com 10 gráficos e 34 marcadores,
Ventos com 1 gráfico e 4 marcadores, Histórico no grupo Ambiente externo com
1 gráfico e 10 marcadores. Controles de período e grupo presentes nas abas
correspondentes. Capturas desktop e celular do Histórico revisadas visualmente:
sem a barra e sem espaço reservado para ela.

O teste registrou um aviso recuperável de hidratação React #418 em clima no
celular; as seis abas e seus gráficos renderizaram. As outras três combinações
não registraram erros de página. Não foi determinada a origem desse aviso.
Os resultados por aba estão em `history-window-qa-20261016.json`.

A reexecução final do script em modo de leitura confirmou zero arquivos a
alterar em ambos os serviços.
