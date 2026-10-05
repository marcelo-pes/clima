# Checkpoint de retomada — 05/10/2026

Interrompido a pedido do usuário após concluir a etapa de correções, recuperação e testes. **Não fazer novas implantações nem alterar DNS ou visibilidade nesta pausa.** Alterações locais preservadas. Não reexecutar a recuperação já aplicada.

## Código e implantação atual

- Repositório: marcelo-pes/clima. Checkout VPS `/opt/clima2-antaisolar/repository`, branch `fix/clima2-review-20261005`, base `1f62c87caf9854e46d3ffbc0f13618cf32ad27d4`.
- Commit de implementação: `c2d53f9d8cdc00027bbeac4161038f6e5538c0a2`. O commit seguinte contém este checkpoint; consultar `git log -2 --oneline` para seu hash.
- Código local completo: `/Users/pes/clima2-20261005`; snapshot original `/Users/pes/clima-current-20261005`. Diretórios locais sem Git; histórico Git no checkout separado da VPS.
- Clima2 publicado antes da pausa: https://clima2.antaisolar.com.br, `/opt/clima2-antaisolar/app`, Node 22.23.3, `clima2-antaisolar.service`, loopback 8788, Nginx/Let's Encrypt. Última implantação **05/10/2026 19:45:39 UTC (16:45:39 Brasília)**.
- Artefato SHA256 `3d5e85e19a69f1f45f0fe938f25578b17c25cb1d4b998e126b0b1be0f7c416fe`; registro `/opt/clima2-antaisolar/review-deployment.json`; backup do código `/opt/clima2-antaisolar/backups/review-20261005T194539Z/code-before.tar.gz`.
- Original preservado: `/opt/clima-antaisolar/app`, `clima-antaisolar.service`, loopback 8787. Domínio original continua Sites/CNAME custom-domains.chatgpt.site. Nenhuma migração, recriação, mudança DNS ou visibilidade.
- Configurações sem credenciais em `deploy/`; explicação em `docs/clima2-vps.md`; auditoria completa em `docs/audit-2026-10-05.md`.

## SQLite único e importador

Caminho absoluto confirmado por configuração, seleção do importador e descritor aberto do clima2:

`/opt/clima-antaisolar/database/wrangler/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite`

Mesmo banco de produção do backend anterior/importador. Clima2 abre readOnly/query_only, `CLIMA_SQLITE_PATH` explícito, sem banco do Mac, backup ou exemplo. Runtime bloqueia Ecowitt em histórico arquivado e registra `ecowittRequests`. Consultas não importam nem aguardam sincronização.

Único sincronizador `/opt/clima-antaisolar/scripts/ecowitt_history_sync.py`, serviço `clima-antaisolar-archive.service`, timer `clima-antaisolar-archive.timer`, **23:59 America/Sao_Paulo**, Persistent, lock fcntl. O próximo disparo observado era 06/10 às 02:59 UTC. Sem segundo importador para clima2. A opção temporária `--apply-tested-recovery` já foi retirada e preservada no backup; ExecStart voltou ao incremental normal.

## Backup, recuperação e cobertura

- Backup online consistente e cópia de teste com integrity_check=ok: `/opt/clima-antaisolar/backups/coverage-repair-20261005T180900Z/production-before.sqlite` e `recovery-test.sqlite`. Sincronizador anterior/configurações preservados no mesmo diretório.
- Teste isolado: 107.087 pontos distintos adicionais, 103.843 válidos; zero perdas, alterações de valores válidos anteriores ou duplicatas. Relatórios `test-report.json` e `statistics-test.json` no diretório acima.
- Produção: backup adicional `/opt/clima-antaisolar/backups/daily-history-20261005T191540Z.sqlite.gz`, integrity_check e gzip validados antes de escrever. Recuperação aplicada pelo único serviço às 19:21 UTC; incremental/estatísticas terminaram 19:25 UTC, sucesso e quick_check=ok.
- Auditoria final somente leitura encerrada 19:37 UTC: **1.527.897 chaves distintas, 1.484.432 observações numéricas válidas, 43.465 marcadores ausentes, 41 variáveis**, 39.099 linhas derivadas de estatísticas. Aumento válido total 104.596, incluindo 753 observações recentes após o teste.
- `weather_history`: **48 snapshots de respostas sobrepostas**, não 48 leituras. Observações normalizadas em `ecowitt_history_points`, chave estação/variável/timestamp. Não apagar proveniência/cache para “deduplicar”.
- Datas variam por sensor; cobertura principal 12/05/2025 às 21h até 05/10/2026 às 16h15 BRT. CSVs completos por variável e ciclo em `docs/coverage-2026-10-05.csv` e `docs/coverage-gaps-2026-10-05.csv`.
- Relatórios VPS `/opt/clima2-antaisolar/final-coverage-20261005.json` e `.csv`; JSON guarda os 100 últimos exemplos de lacunas por variável/ciclo, totais abrangem todas as lacunas internas.
- Temperatura nominal: 5min 103.812 slots ausentes/13.889 intervalos; 30min 5.973/868; 4hour 6/4; 1day zero internos, 510 pontos até 03/10 às 21h, borda recente diária indisponível na origem. **Slots nominais não equivalem a dados recuperáveis.** API antiga solicitada 5min retorna 4h ou 30min; em 08/07 há uma falta de 5min na própria origem. Não inventar leituras nem declarar cobertura completa pelo checkpoint/backend anterior.
- Distância de raios: 671 valores e 42.262 marcadores ausentes; ausência de evento não é zero nem prova de falha do sensor. Sensores derivados têm primeiras datas diferentes.

## Alterações concluídas

Histórico SQLite exclusivo, dados ao vivo independentes, cabeçalho/horário/alerta preservados, carregamento por seção, cache, cancelamento e descarte de respostas antigas. Alerta de raios exige evento de até 30 minutos e distância até 20 km (até 10 km alerta), sem alerta baseado em evento antigo. Vento atual independente do período, média circular últimos 10 minutos e bússola consistente (117° ESE/Leste-sudeste).

Estatísticas separadas da série agregada; temperatura máxima anual disponível 37,5 °C, semanal 35,3 °C após recuperação; 30,1 °C era máxima da série diária agregada. Rajada 118,4 km/h de 19/10/2025 às 05h confirmada na origem e preservada. Pressões corretamente mapeadas; igualdade também existe na origem. VPD/unidades conferidos; chuva não soma/empilha acumuladores; resets tratados.

Datas naive API em Brasília, epochs preservados (diário 00 UTC = 21h BRT). Dia civil, semanal de dias encerrados, mensal 30 dias e anual 365 com limites explícitos. Gráficos montam apenas com dimensões positivas, sem cortes/continuidade artificial em lacunas, unidades/eixos adequados. Bateria sem [object Object], títulos corrigidos, CSV/table/tooltip formatados. Mapa com coordenadas/link externo sem WebGL obrigatório; satélite independente, camadas/link preservados, fuso do provedor identificado. Astro compartilhado e “Céu limpo” identificado como previsão.

## Testes e resultados

- TypeScript/build e testes `weather-rules.test.mjs`, `history-coverage.test.mjs`, `weather-database-only.test.mjs`, `history-point-merge.test.py`: aprovados.
- Chrome isolado desktop 1440×1000 e celular 390×844: 8 grupos × 4 períodos × 2 tamanhos aprovados. Zero erros React/dimensões inválidas/overflow; zero curvas/eixos cortados.
- Troca rápida: última resposta vence; navegação Ventos/Histórico mantém período sem consultas duplicadas; vento atual permanece após Anual. Cache, data anterior/próxima, tabela, CSV por grupo e todos, tooltip, perfil, #map, satélite, erro de rede e período vazio testados.
- Último teste da implantação 19:45 confirmou extremos exibidos 37,5 °C/118,4 km/h, CSV completo correto, tooltip em Brasília, #map, satélite e texto atualizado de /confere. Sem erros.
- Histórico semanal/mensal/anual e abertura direta: logs **zero chamadas Ecowitt**, incluindo cabeçalho. Hoje/atualização ao vivo e comparação explícita `source=api` permanecem separados.
- Backend histórico 33–240 ms; trocas até utilizável 1,59–2,30 s; abertura direta fria desktop 4,17 s/celular 3,31 s; retorno em cache ~0,37 s sem consulta. Hoje ao vivo 6,25–9,23 s, depende API. Estatísticas primeira 47–267 ms/cache 14–29 ms.
- Serviços ativos, NRestarts=0, Nginx -t aprovado, timer ativo, HTTPS válido até 03/01/2027, certbot.timer ativo; dry-run de renovação aprovado na preparação. Pico sincronizador 180 MB; auditoria 160 MB limitada, ambos encerrados. Sem importador concorrente.
- Evidências locais `/Users/pes/clima2-qa-20261005/`: comparison-before.json, review-results-fast.json, final-matrix.json, rapid-results.json, final-details.json, results.json, results-mobile.json. VPS final-statistics-tests.json e final-http-tests.json.

## Erros e pendências reais

1. Primeiro teste isolado excedeu RAM (352 MB) e foi morto pelo OOM; nenhum dado de produção escrito então. Substituído por streaming, limites de memória/CPU; novo teste e produção encerraram com sucesso. Todas as unidades temporárias encerradas, sem timer.
2. Dois testes de UI falharam por seletores do próprio teste (nome do período e Exportar versus Exportar CSV); corrigidos e reexecutados com aprovação. Erro net::ERR_FAILED nos testes de rede é deliberado; não é falha espontânea.
3. Lacunas/baixa resolução e borda diária recente na origem permanecem identificadas como parcial. Não é autorizado preencher dados inventados ou criar importador concorrente.
4. Original público apresentou HTTP503 em source=database anteriormente. Probes da VPS recebem 403 de borda e não provam falha interna; navegador permitiu comparar os seis recursos. Backend original na VPS responde 200. Não assumir exclusão por “project not found”; implantação pública Sites/DNS preservada.
5. /confere monta corretamente e o fluxo de consulta está implementado, mas falta registrar a comparação completa após ambas as respostas chegarem, em período encerrado, com os mesmos limites/variável/ciclo. O teste final somente conferiu montagem/textos, não concluiu essa comparação visual.
6. Ainda não foi observado o próximo disparo noturno de 23:59 com o sincronizador corrigido; conferir journal após esse horário. Timer/configuração e execução manual normal dentro da aplicação testada foram verificados.

7. Commit de implementação e checkpoint salvos na branch da VPS. **Push tentou autenticar, mas o GitHub rejeitou a chave por estar marcada como read only. Nenhum commit perdido.** Enviar a branch depois com credencial de escrita autorizada: `git -C /opt/clima2-antaisolar/repository push -u origin fix/clima2-review-20261005`. Não trocar a chave de implantação nem expor credenciais.

## Próximo passo exato ao retomar

**Primeiro ler este checkpoint e a auditoria; não repetir a recuperação nem implantar automaticamente.**

1. Na VPS conferir `git -C /opt/clima2-antaisolar/repository log -2 --oneline`, `review-deployment.json`, `systemctl status clima2-antaisolar clima-antaisolar clima-antaisolar-archive.timer` e `journalctl -u clima-antaisolar-archive.service --since '2026-10-05 19:25:00'`. Confirmar sucesso do próximo disparo 23:59 BRT e backup novo, sem sobreposição.
2. Abrir /confere, selecionar Semanal com referência 05/10/2026 (28/09–04/10), aguardar ambas as fontes, registrar status, limites, timestamps e diferenças por variável. Comparação `source=api` é deliberada; os gráficos normais devem continuar zero Ecowitt. Não mudar DNS/visibilidade.
3. Analisar somente lacunas que ainda sejam recuperáveis na origem, com consultas delimitadas e relatório de resolução. Qualquer nova escrita exige backup consistente validado e passa pelo único sincronizador. Manter as lacunas indisponíveis como parcial.
4. Entregar ao usuário o relatório final com links da auditoria, cobertura, commit e medições. Qualquer nova implantação depende de retomada explícita após esta pausa.

Credenciais, banco e backups não estão no Git. O arquivo herdado `RESUME-2026-10-05.md` permanece local/não rastreado por conter notas históricas superadas; este checkpoint prevalece.
