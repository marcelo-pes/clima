# Clima2 na DigitalOcean

clima2.antaisolar.com.br hospeda frontend e backend na VPS 143.244.163.249, separadamente do domínio original. Não publicar esta implantação pelo projeto Sites herdado nem alterar o DNS de clima.antaisolar.com.br.

## Fonte única

SQLite de produção:
`/opt/clima-antaisolar/database/wrangler/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite`

`clima2-antaisolar.service` configura `CLIMA_SQLITE_PATH` explicitamente, escuta 127.0.0.1:8788, usuário clima2, Node 22.23.3, Restart=on-failure. O runtime abre o banco readOnly/query_only; run é bloqueado. O diretório do banco é ReadOnlyPaths. Segredos apenas em `.runtime.vars` com permissão 600, fora do Git. Nginx serve `_next/static` e encaminha páginas/API para 8788; HTTPS com Certbot com timer de renovação. O endpoint de importação é bloqueado no clima2.

## Separação dos fluxos

Semanal/mensal/anual e dias encerrados usam SQLite, sem fallback para Ecowitt. O runtime bloqueia chamadas Ecowitt nesses pedidos e registra range, view, status, durationMs e ecowittRequests. Abrir gráficos não importa, não gera estatísticas nem espera sincronização. Dados atuais, previsão e iframe satélite têm estados independentes. Últimos dados válidos e horário permanecem durante troca de período/falhas. Respostas antigas são descartadas.

`?range=1y&date=2026-10-05#evolution` abre histórico diretamente. `/confere` compara fontes explicitamente com os mesmos intervalos/ciclos/fuso. `source=api` é a exceção deliberada de comparação. Os gráficos normais jamais usam essa exceção.

## Intervalos e cobertura

Dia civil: 00:00 até 23:59:59 de Brasília, limitado ao presente quando hoje. Semanal: 7 dias civis encerrados anteriores à data de referência. Mensal: 30 dias civis incluindo data final; anual: 365 dias civis incluindo data final. A resposta informa limites ISO, fuso e ciclo. Não chamar dia civil de últimas 24 horas.

Parâmetros de datas naive da Ecowitt devem ser formatados em America/Sao_Paulo. Epochs da origem são preservados; um ponto diário às 00 UTC aparece corretamente às 21 BRT. Não deslocar os epochs para esconder lacunas.

`weather_history` contém snapshots de respostas sobrepostas, não uma observação por linha. Observações distintas estão em `ecowitt_history_points`, chave(device,metric_path,observed_at). '-' é ausência; zero numérico é válido. `cycle_type` registra o ciclo SOLICITADO: a origem pode reduzir a cadência de históricos antigos. Contagem de checkpoints ou comparação com outro backend não comprova cobertura. Cobertura verifica cadência, extremos do intervalo e variáveis essenciais; status partial/complete/empty e `historyIncomplete` não se baseiam em receber alguns pontos. Ausência de detecção de raio não equivale a falha do sensor.

Máximos das médias diárias não são máximos observados. Série anual é identificada como agregação da origem; extremos high/low são usados quando disponíveis e estatísticas separadas consultam observações do SQLite. Médias por ciclo são amostrais e não média temporal anual. Acumuladores de chuva não são somados/empilhados. Reset é tratado separadamente de incremento.

## Alertas e vento

Raio atual exige timestamp de detecção conhecido, idade de 0 a 30 minutos e distância<=20km. Até 10 km: alerta; 10–20 km: atenção. Evento antigo conserva distância/data da última detecção, mas não alerta atual. Critério local, não estimativa de evento futuro. Falta de timestamp não autoriza atividade recente.

Vento atual permanece independente do período histórico. Média direcional usa apenas últimos 10 minutos e vetor seno/cosseno; vetor resultante nulo não produz direção inventada. Bússola de 16 setores com siglas internacionais e nomes portugueses:117° = ESE = Leste-sudeste. Não substituir por média aritmética de graus. Bateria mostra estado/unidade recebido, sem converter flags em percentuais inventados.

## Manutenção única

Somente `clima-antaisolar-archive.timer`, às 23:59 America/Sao_Paulo, com Persistent, executa `/opt/clima-antaisolar/scripts/ecowitt_history_sync.py`. Não criar timer/importador para clima2. A rotina usa lock fcntl, backup SQLite online, integrity_check, gzip verificado e preserva backups anteriores. Recuperação preserva valores válidos e payloads de proveniência; tabelas derivadas de estatísticas são geradas pela mesma rotina em segundo plano.

## Implantação e retomada

Compilar no Mac; não fazer build pesado na VPS de 1 GB. Antes de mudanças preservar código/configurações e fazer backup consistente do SQLite se houver escrita. Enviar artefato sem node_modules, credenciais e banco. Manter implantação original na porta 8787; reiniciar só clima2 após instalar artefato. Registrar hash do artefato, commit Git, data, backup e testes em `/opt/clima2-antaisolar/REVIEW-RESUME-2026-10-05.md` e`review-deployment.json`.

Conferir unidades/journal, descritores do DB, nginx -t, HTTPS, timers, reinícios, RAM e CPU. Testar 8 grupos nos 4 períodos, desktop/mobile, CSV, tabela, datas, erro de rede e troca rápida. Logs dos períodos arquivados devem mostrar ecowittRequests=0. Erros de iframe/ extensão não são erros da aplicação; mapa oferece coordenadas/link externo e não bloqueia os sensores.
