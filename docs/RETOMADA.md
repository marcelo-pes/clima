# Checkpoint final — 06/10/2026

Este é o estado final após a continuidade e publicação explicitamente autorizadas pelo usuário. A pausa de 05/10 e a verificação inicial de 06/10 estão preservadas como registros históricos; não representam pendências atuais. **Não repetir a recuperação já concluída. Preservar o original, DNS, domínio, visibilidade e dados; qualquer futura implantação precisa estar autorizada no contexto da nova tarefa.**

## Efetivamente publicado

- URL: https://clima2.antaisolar.com.br.
- Commit de código: **a2892eb1af408fe28c280ea7c50e95a0ffc08059** (`a2892eb`). Publicado em **06/10/2026 14:24:52 UTC / 11:24:52 America/Sao_Paulo**.
- Artefato SHA256: `c15ed98e7733685b85599b4d93e8aeb46b7299fdbaa5a029f7e0413f2b87cda6`.
- Registro verificável: `/opt/clima2-antaisolar/review-deployment.json`. Aplicação `/opt/clima2-antaisolar/app`, `clima2-antaisolar.service`, Node 22.23.3, loopback 8788. Active, NRestarts=0, healthz e HTTPS públicos verificados.
- Inclui bateria correta, pinos de mínimo/máximo, tooltips do /confere, atualização ao vivo e todos os ajustes de largura/cards. Não há ajuste de largura pendente. Limite original de 1600 px mantido; telas de 320 a 1920 px testadas.
- Publicação final conferida em Chrome 1440×1000 e 390×844: 64 combinações de grupo/período, seis abas, CSV/tabela, período vazio, bateria e cards. Zero erros/warnings, cortes de pinos ou overflow nos elementos examinados.
- Original `/opt/clima-antaisolar/app`, serviço loopback 8787, não publicado/reiniciado nesta execução; ativo desde 05/10 17:17:36 UTC. Clima original público/DNS/Sites/visibilidade preservados. Banco compartilhado recebeu apenas a recuperação/importação autorizada, preservando os registros anteriores.

## Ajuste da aba Satélite às 11:24:52

Coluna centralizada de 522 px seguindo o original, painel de condições alinhado e iframe compacto sem painéis laterais indevidos. Reprodução/data/horário, cinco camadas, proporção nativa, animação e link externo preservados; crédito fora da imagem. Em celular muito estreito, redução uniforme do iframe evita o layout quebrado do provedor. Testes locais e públicos em 1440/900/600/390/320 px; animação real verificada em 1440 e 320. Outras abas mantêm a largura anterior. Backup/reversão `/opt/clima2-antaisolar/backups/satellite-layout-20261006T142449Z/`. Captura pública do computador em `/Users/pes/clima2-qa-20261005/audit-20261006/satellite-public-1440.png`. Ver [satelite-2026-10-06.md](satelite-2026-10-06.md).

## Ajuste visual posterior às 10:50:40

Os dois blocos técnicos e o aviso equivalente da sequência de gráficos foram removidos do painel público, sem espaços residuais. Estatísticas e diagnóstico de cobertura continuam no /confere. Apenas dois componentes de renderização alterados; cálculos, indicadores, consultas e sincronização preservados. Backup imediato da versão 442fc50 e reversão em `/opt/clima2-antaisolar/backups/visual-diagnostics-20261006T135037Z/`. Ver [visual-diagnostics-2026-10-06.md](visual-diagnostics-2026-10-06.md). As medições/auditoria histórica abaixo são da correção anterior e continuam válidas; não se repetiu a recuperação.

## Correções e regras

Bateria WH57: `battery/lightning_sensor` informa nível documentado 0–5; percentual normalizado `nível × 20`, leitura 3 = **60%**, barras [100,100,40,0] entre quatro segmentos. Percentual explícito respeitado; ausência/estado não vira zero. `battery/haptic_array_battery` e `battery/haptic_array_capacitor` informam **V**, exibidos 2,5 V e 2,4 V na verificação pública; nenhuma conversão tensão→percentual. Histórico WH57 não está disponível nas respostas/banco auditados. Fundamentação em [bateria-e-extremos-2026-10-06.md](bateria-e-extremos-2026-10-06.md).

Extremos do período inteiro antes da redução do desenho: SQLite agrega estatísticas diárias com timestamps e lê dados brutos apenas nas bordas parciais. High/low da origem considerados; zero válido preservado, leituras ausentes ignoradas, vazio sem extremos, constante com pinos lado a lado. Fuso America/Sao_Paulo. Gráficos corrigidos: externo/VPD, interno, solar/UV, velocidade/rajada, pressão e tensões de bateria; raios/distância conserva faixa de extremos. Chuva/acumuladores e direção circular seguem as exclusões do original, sem extremos lineares indevidos. 18 variáveis × três períodos validadas contra registros SQLite; máximas anuais públicas **37,5 °C / 118,4 km/h**.

Raios: “Sem atividade recente” inteiro em uma linha, sem sobreposição. Vento: rótulos, velocidade/rajada e km/h completos; espaço da bússola adaptável. Demais cards e unidades revisados, sem esconder conteúdo nem reduzir excessivamente as fontes.

## Histórico e /confere

SQLite único de produção:

`/opt/clima-antaisolar/database/wrangler/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite`

Clima2 readOnly/query_only; rota de escrita/archive bloqueada. Histórico semanal/mensal/anual normal: runtime sqliteOnly=true, **ecowittRequests=0**, confirmado por código, requisições e logs. Abrir/trocar período não importa dados. Atualização atual preservada; cache vivo 45 s e HTTP no-store, timer 60 s/manual testados.

/confere usa comparisonExtrema na mesma resolução em ambas as fontes, com limites/fuso explícitos. Referência 05/10: mensal 06/09–05/10, ciclo 4hour, **5.239 pares**; anual 06/10/2025–05/10/2026, ciclo 1day, **10.652 pares**. Zero diferenças, zero exclusivos, unidades e extremos correspondentes; vinte gráficos testados no computador/celular. Semanal já concluído anteriormente: 9.752 pares, zero diferenças; não repetido externamente. Chamadas source=api do /confere são deliberadas e separadas do histórico normal.

Última rodada pública final: abertura anual direta 2,244–2,880 s; troca mensal 0,685–0,750 s, semanal 0,884–0,998 s; retorno ao anual em cache 0,394–0,420 s sem requisição adicional. Backend na rodada publicada anterior ao ajuste exclusivamente visual de limite: semanal 539,7–645,1 ms; mensal 57,3–129,8 ms; anual 9,2–521,1 ms (inclui cache de extremos). Condições e evidências em [audit-2026-10-06.md](audit-2026-10-06.md).

## Recuperação e preservação

563/563 janelas de origem concluídas pelo único sincronizador, zero falhas, com backup validado antes de escrita e retomada após interrupção. Final 12:49:55 UTC, failed=false/quick_check=ok. Estatísticas 39.216 linhas, com timestamps.

Auditoria final exaustiva: **1.534.840 chaves / 1.491.260 valores válidos / 41 variáveis**. Aumento 3.941 chaves / 3.918 válidos inclui recuperação e incremental recente. **Zero perdas, zero mudanças de valores válidos existentes, zero duplicatas; cache e proveniência preservados; integrity_check=ok.** Relatórios coverage-after, preservation e source-gaps de 06/10 em docs/.

Origem antiga frequentemente devolve resolução mais baixa ou agregado diário; ausências foram registradas, não preenchidas. Payloads/progresso em `/opt/clima-antaisolar/backups/gap-repair-6cf9f3a60babe245/`. Não reexecutar production-repair-plan.json automaticamente.

## Agendamento, backups e reversão

Único `/opt/clima-antaisolar/scripts/ecowitt_history_sync.py`; clima-antaisolar-archive.service/timer, **23:59 America/Sao_Paulo**, enabled/active/Persistent/lock exclusivo. Disparo de 05/10 23:59 confirmado e backup íntegro. Próximo 06/10 23:59 BRT = 07/10 02:59 UTC. Novo mecanismo durável salva pendência antes da rede, retenta após falha mesmo fora da retenção e não duplica; testes passaram. Drop-in temporário de reparo removido, incremental normal restaurado.

Backup/reversão `/opt/clima2-antaisolar/backups/audit-20261006T113100Z/`: production-before.sqlite/.gz, código anterior e backups imediatamente antes das publicações, scripts/unidades e relatórios. rollback-code.sh restaura frontend/sincronizador, **preserva o SQLite recuperado** e o script de estatísticas compatível com as colunas novas. Nunca restaurar o banco antigo para reverter uma alteração de frontend.

## Git e locais

Repositório marcelo-pes/clima, branch **fix/clima2-review-20261005**. Autenticação HTTPS de escrita do Mac funcionou; commits enviados. Chave SSH da VPS continua somente leitura, sem alteração/credencial exposta. GitHub/main não foi mesclado nem forçado. Código publicado a2892eb; commit posterior apenas de documentação inclui este checkpoint. Consultar git log para o hash do checkpoint.

- Fonte principal `/Users/pes/clima2-20261005` (snapshot sem Git).
- Git local `/Users/pes/clima2-git-20261006`; VPS `/opt/clima2-antaisolar/repository`.
- Evidências QA `/Users/pes/clima2-qa-20261005/audit-20261006/`; relatórios selecionados em docs/.
- Histórico preservado em RETOMADA-2026-10-05.md e retomada-2026-10-06.md, marcado como verificação inicial superada.

## Pendências reais

1. Lacunas/resolução fina não disponíveis na origem; cobertura continua parcial onde indicado. Não interpolar nem afirmar cobertura integral.
2. Percentual dos campos hápticos em V não disponível sem curva documentada aplicável; leitura em V é a exibição correta. Não existe série histórica WH57 auditável nas respostas consultadas.
3. Próximo disparo noturno com a rotina nova ainda não ocorreu no horário do fechamento; conferir journal após 23:59, sem repetir o reparo. Agendamento, backups e retomada já verificados.
4. Provedores externos de mapa/satélite podem limitar disponibilidade; não se declara equivalência integral entre os sites.

Nenhuma pendência de publicação, largura, autenticação ou envio dos commits.
