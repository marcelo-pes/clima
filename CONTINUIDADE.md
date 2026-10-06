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

---

# Continuidade de trabalho — 06/10/2026

Este arquivo preserva o checkpoint acima e acrescenta o estado da árvore de trabalho escolhida como raiz exclusiva: `/Users/pes/clima2-git-20261006`. Não mover, mesclar ou apagar as demais cópias. Alterar arquivos do projeto somente dentro desta raiz; arquivos temporários ficam fora apenas quando uma etapa exigir isso, e devem ser tratados separadamente.

## Estado local atual

- Raiz Git: `/Users/pes/clima2-git-20261006`.
- Branch: `fix/clima2-review-20261005`, acompanhando `origin/fix/clima2-review-20261005`.
- HEAD: `0d70b32` — `docs: record satellite reference comparison and final public validation`.
- A árvore está à frente/atrás de origin em zero commits. Há três arquivos rastreados modificados e quatro arquivos não rastreados (os três módulos abaixo e este registro). Nenhum deles foi descartado ou movido:
  - Modificados: `app/api/weather/route.ts`, `app/globals.css`, `app/weather-dashboard.tsx`.
  - Novos: `lib/climatempo-current.ts`, `lib/sun-time.ts`, `lib/weather-condition.ts`.
- `CONTINUIDADE.md` é o registro criado nesta organização e também ficará novo/não rastreado até ser commitado deliberadamente.
- A cópia `/Users/pes/clima2-20261005` permanece intacta e não é raiz de trabalho.

## Trabalho em andamento e pendências

Está em preparação a atualização da aba **Previsão** para usar a condição atual de Bauru (Climatempo, cidade 406/localidade 6655). O código local ainda não foi compilado, testado, comitado, enviado ou publicado. A última versão conhecida publicada continua sendo a indicada no checkpoint acima.

As alterações locais atuais já substituem a antiga detecção por previsão de 15 dias/Open-Meteo por um leitor do endpoint público atual do Climatempo; centralizam código, texto, ícone, imagem e período dia/noite; e adicionam estado neutro para condição desconhecida, inválida ou desatualizada. Os horários `dateUpdate` do feed chegam sem fuso. O código atual interpreta esse campo como UTC com base em comparação empírica com relógio/atualizações do provedor; essa premissa precisa ser reconfirmada e documentada claramente antes da publicação.

Próximos passos, sem repetir as etapas já concluídas do checkpoint:

1. Revisar as alterações locais e validar defensivamente a leitura/parsing do feed, a validade do horário e o comportamento neutro para falha, dado inválido, desconhecido ou antigo.
2. Conferir o mapeamento contra a tabela oficial de condições do Climatempo; testar códigos diurnos/noturnos, crepúsculo, meia-noite e códigos sem equivalência documentada.
3. Inspecionar e otimizar as imagens necessárias. Adicionar os assets do projeto apenas dentro desta raiz, mantendo imagens leves e sem carregar imagens não selecionadas.
4. Executar testes unitários/integração e build. Validar a aba Previsão em computador e celular, com leitura válida/fresca, falha, dado ausente, condição desconhecida e desatualizada.
5. Conferir o estado de deploy atual, fazer backup do código/configuração da VPS e preparar reversão. Publicar somente em `clima2.antaisolar.com.br` depois de validação; preservar o clima original, DNS, domínio, visibilidade e SQLite.
6. Conferir a página pública, registrar fonte, horário realmente observado, conversão de fuso aplicada e a correspondência condição/foto. Atualizar este registro com resultado, commit/versão, horário e pendências reais.

Há variantes de imagem geradas anteriormente fora do projeto em `/Users/pes/.codex/generated_images/01a110ee-1f55-7ce1-8953-db14a54ae64a/` (céu parcialmente nublado, nublado, chuva, tempestade e neblina, dia/noite). Permanecem fora da raiz e não foram copiadas nem modificadas nesta organização; antes de usá-las, inspecionar cada arquivo e otimizar o tamanho ao adicioná-lo ao projeto.

## Comparação com a outra cópia

Leitura recursiva comparando `/Users/pes/clima2-git-20261006` com `/Users/pes/clima2-20261005` (ignorando `.git` e `node_modules`) encontrou:

- O checkpoint `docs/RETOMADA.md` é idêntico nas duas pastas (SHA-256 `451c1b702209fda97a061fd7364c049dad345c494098627f36ef22e35f3729f7`).
- As mudanças locais de `app/api/weather/route.ts`, `app/globals.css` e `app/weather-dashboard.tsx`, e os três módulos novos em `lib/`, existem apenas na raiz escolhida; foram preservados nela e não foram copiados para a outra pasta.
- Apenas na outra cópia aparecem `RESUME-2026-10-05.md`, `next-env.d.ts`, `tsconfig.tsbuildinfo`, `.next/`, `.wrangler/` e `dist/`. São um registro antigo e saídas/estado de build local. Não foi identificado código-fonte ou documento de retomada mais recente ausente na raiz escolhida; o checkpoint de 06/10 da raiz escolhida é mais atual que `RESUME-2026-10-05.md`. Nada foi incorporado nem alterado na outra cópia.

## Comandos para retomar e trabalhar localmente

No terminal, entrar na raiz e conferir o estado sem descartar alterações:

```bash
cd /Users/pes/clima2-git-20261006
git status --short --branch
git diff
```

Com dependências já instaladas, usar `npm run dev` para desenvolvimento local, `npm run lint` para lint e `npm run build` para a compilação. A instalação travada, se realmente necessária, é `npm run install:ci`; não reinstalar dependências sem necessidade. Antes de qualquer publicação, seguir backup, build e validação descritos acima. Não executar comandos que limpem ou restaurem a árvore Git.

## Permissões e retomada do Codex

Durante esta sessão, a permissão técnica reportada pelo sandbox permite escrita em `/Users/pes` e diretórios temporários; portanto, o sandbox atual não isola tecnicamente as gravações na raiz escolhida. A restrição de usar somente `/Users/pes/clima2-git-20261006` foi seguida por instrução do usuário. Em `workspace-write`, a leitura fora do projeto continua normalmente possível e diretórios temporários ainda podem ser graváveis.

Para abrir o seletor de sessões do Codex, sem filtrar sessões pelo diretório anterior, e retomar esta conversa selecionando-a:

```bash
codex resume --all --cd /Users/pes/clima2-git-20261006 --sandbox workspace-write --ask-for-approval on-request
```

O comando abre o seletor e deixa o usuário escolher a sessão; não tenho acesso a um identificador desta conversa para fixá-lo no comando. Se esta conversa não aparecer no seletor, a limitação é que o ambiente atual pode não registrar sessões nesta instalação local do Codex. Nesse caso, inicie uma sessão nova com `codex --cd /Users/pes/clima2-git-20261006 --sandbox workspace-write --ask-for-approval on-request` e leia este arquivo. As alterações preservadas estão nos arquivos da árvore de trabalho, independentemente da retomada do histórico.

## Atualização HP10 — 06/10/2026, 18:36 UTC

O usuário pediu busca automática da captura HP10 mais recente a cada 10 minutos e depois pediu consulta à Ecowitt no mesmo intervalo da câmera, 5 minutos. A configuração foi atualizada e publicada somente no clima2: cache por identificador/horário, validade máxima de 20 minutos, hora em `America/Sao_Paulo` e confirmação de chuva por leitura recente da estação.

- Nova versão: runtime SHA-256 `4b8d2b9cb193b1e898250a6c343dc2b3ce79b03b64d1f59476b5a35f25a7aaa8`, baseada no commit local `0d70b32` mais alterações ainda não commitadas. Registro `/opt/clima2-antaisolar/review-deployment.json`; `working_tree_changes=true`, SQLite não modificado. Publicada em 06/10/2026 18:36:15 UTC. Backup/reversão anterior: `/opt/clima2-antaisolar/backups/camera-hp10-5m-20261006T183554Z/`; `code-before.tar.gz` SHA-256 `91b12f8e4c4391387d153f13bf58e68a97637536bd5d9de53178909a461fe312` e `rollback-code.sh`.
- Serviço `clima2-antaisolar` ativo, zero reinícios, `CacheDirectory=clima2-antaisolar`; persistência em `/var/cache/clima2-antaisolar`. Cache atual mantém JPEG e metadado em arquivos protegidos do usuário `clima2`.
- Processo atualiza imediatamente ao iniciar e repete a cada **300.000 ms (5 minutos)**, independente de visitantes. Compara `data.camera.photo.time`; timestamp igual atualiza a leitura dos sensores/cache de metadados sem baixar a imagem nem refazer análise. O ciclo também consulta a taxa recente `rain_rate` em `mm/hr` (`rainfall_unitid=12`). Chuva só é confirmada com taxa > 0 e timestamp recente. Acumulado diário não é interpretado como chuva atual.
- `GET /api/camera` é servido do cache e não faz chamadas à Ecowitt; `GET /api/camera/image` entrega a JPEG validada em cache. Após reiniciar às 18:36:15 UTC, iniciou e obteve nova captura às 18:36:18 UTC: epoch `1791311510` (06/10/2026 15:31:50 BRT), 89.578 bytes. Validação pública às 18:36:26 UTC: JPEG HTTP 200 com ETag `hp10-1791311510`; serviço ativo e zero reinícios. O próximo ciclo periódico vence às 18:41:15 UTC e ainda não havia ocorrido na checagem.
- A imagem recebida pode ser exibida no painel da aba Previsão com sua proporção preservada e rótulo `Imagem capturada às HH:mm` no fuso local. Depois de 20 min, endpoint da imagem deixa de servir a captura e a interface retorna ao fundo meteorológico, indicando que ela está antiga/indisponível. A condição observada da câmera continua conceitualmente separada da previsão meteorológica.

### Limitação funcional que continua pendente

Não foi encontrada no projeto nem no servidor uma biblioteca/modelo de visão configurado ou credencial de um serviço de análise de imagem. Não introduzir uma classificação por heurística visual: iluminação baixa à noite, obstáculos e imagens encobertas não permitem inferir céu ou chuva com segurança. O código publicado registra explicitamente `visualCondition=null` e `analysisStatus=classifier_not_configured`; portanto, **não classifica a captura nem a usa como fundo classificado**. O fundo meteorológico atual permanece como fallback e o painel pode mostrar a imagem separada para inspeção. O suporte automático para céu limpo/parcial/nublado/encoberto/neblina/chuva exige integrar e configurar um analisador de imagem confiável; essa dependência ainda não existe e precisa ser resolvida antes de afirmar que a classificação visual foi concluída. A fonte HP10 apenas fornece `photo.time` e URL da foto por `call_back=camera`; a chamada consultada não expôs sequência/vídeo.

### Verificação e próximos passos

`npm run build`, `node scripts/camera-service.test.mjs`, `node scripts/climatempo-current.test.mjs`, `node scripts/weather-database-only.test.mjs`, lint focado e `git diff --check` passaram antes da implantação. Após mudar a cadência, o teste do serviço e build passaram de novo; teste confirma `pollIntervalMs=300000`. Cobertura: timestamp repetido/novo, persistência, zero chamadas Ecowitt por visitante, JPEG, privacidade, frescor da chuva e expiração. O caminho de background classificado não pode ser exercitado sem classificador real. Não houve captura visual automatizada de computador/celular nesta sessão porque a ferramenta de navegador não está disponível.

O sandbox bloqueou a primeira conexão SSH (`Operation not permitted`). A verificação escalada confirmou o deploy; ocorreu um 502 transitório durante restart, seguido de `/healthz` 200, homepage/API de câmera públicas e imagem HTTP 200. O novo processo iniciou às 18:36:15 UTC, registrou `camera_refresh_ok` com captura nova três segundos depois e está ativo, `NRestarts=0`. O próximo ciclo vence por volta de 18:41:15 UTC; consultar journal após esse horário para confirmação periódica real.

Árvore local ainda contém alterações modificadas/não rastreadas listadas por `git status --short`; foram preservadas. Não houve commit novo nem escrita ao GitHub nesta rodada. O clima original, DNS e domínio não foram alterados.

Pedido de 06/10/2026 18:31 UTC: atualizar consulta Ecowitt de 10 para 5 minutos. Modificados `runtime/camera-service.mjs` (`POLL_MS=300_000`), teste de timing e `docs/camera-hp10.md`. Build/testes passaram; publicação às 18:36:15 UTC. Confirmar journal após 18:41:15 UTC.

## Apresentação da aba Previsão — 06/10/2026, 18:48 UTC

O usuário solicitou alterações visuais e confirmou que o ciclo Ecowitt/HP10 deve permanecer em **5 minutos** (prevalece a correção mais recente). A coleta, deduplicação por `photo.time`, cache de 20 minutos, endpoint e campos diagnósticos não foram alterados nesta publicação; a classificação de imagem continua indisponível (`classifier_not_configured`) conforme a pendência acima.

Em `app/weather-dashboard.tsx`:

- A atribuição da condição atual agora aparece como “Condição atual · Climatempo”, sem ID 406.
- Data/hora da atualização continua formatada em `America/Sao_Paulo`, mas o nome do fuso não é mostrado.
- Removido o horário da captura da legenda e do estado da imagem HP10 na interface. Captura e horário continuam nos metadados internos `/api/camera` e no cache persistente.
- Removidas as frases de condição visual indeterminada e a explicação sobre o fundo meteorológico.
- Mantida a leitura/horário dos sensores Ecowitt visível na legenda da foto, sem alteração dos dados ou confirmação de chuva.

Validação: testes `camera-service`, `climatempo-current`, `weather-database-only`, build e `git diff --check` passaram. Inspeção dos 7 assets JS/CSS públicos: novo texto presente; rótulo com 406, frases removidas, sufixo `America/Sao_Paulo` e `Imagem capturada às` ausentes. Endpoint público HP10 imagem retornou HTTP 200 (91.809 bytes), serviço ativo e `NRestarts=0`. A interface usa regras responsivas já existentes até 720 px e 470 px; a imagem é `width:100%`, `height:auto`, `object-fit:contain`. A ferramenta de navegador/screenshot não está disponível nesta sessão, então não houve inspeção visual real em viewport desktop/mobile; não declarar essa parte como conferida visualmente.

Publicado somente no clima2 em 06/10/2026 18:48:42 UTC (15:48:42 BRT). SHA-256 do artefato de build: `6ab88fb50219df3815d91b184e2fafd8074a8532ecc8b5b75e4bacd247ff108a`; backup e reversão em `/opt/clima2-antaisolar/backups/presentation-forecast-20261006T184744Z/` (backup SHA `261460c9a34cd5ee0cde37dfe914a79aab28538c9306fe4ce9ad7b7af23469a2`). Registro remoto: `/opt/clima2-antaisolar/review-deployment.json`. Não alterados SQLite, serviço do clima original nem DNS. Árvore de trabalho e arquivos não rastreados preservados; nenhum commit criado nesta rodada.
