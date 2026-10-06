# Bateria e extremos — implementação de 06/10/2026

## Significado da bateria

A Ecowitt retornou `battery/lightning_sensor` com valor `3`, unidade vazia, e `haptic_array_battery=2.50 V`, `haptic_array_capacitor=2.4 V`. O SQLite histórico tem as duas variáveis hápticas com unidade V; não contém histórico numérico do nível do sensor de raios nessa auditoria. Ausência não significa zero.

Documento primário: [Ecowitt HTTP API v1.0.5, tabela eWH57_SENSOR, página 17](https://oss.ecowitt.net/uploads/20260109/HTTP%20API%20interface%20Protocol%20(Generic)-(V1.0.5-2025-10-08)%20.pdf), nível 0–5. Confirmação adicional: [protocolo TCP v1.6.4, WH57 0–5](https://osswww.ecowitt.net/uploads/20220407/WN1900%20GW1000,1100%20WH2680,2650%20telenet%20v1.6.4.pdf).

| Campo | Exibição | Regra |
|---|---|---|
| battery/lightning_sensor (WH57), sem unidade | Nível normalizado em % | nível × 100/5; 3/5 = 60%. É a fração do nível reportado, não uma estimativa energética por tensão. |
| Campo com unidade % explícita | Percentual da origem | Aceita valores finitos de 0 a 100, sem mudança de escala. |
| battery/haptic_array_battery | Tensão em V | Sem curva documentada aplicável de tensão para carga; não converter. |
| battery/haptic_array_capacitor | Tensão em V | Não interpretar como percentual de bateria. |
| Estado textual | Normal/Baixa/Offline | Não inventar percentual de um estado. |
| Ausente, nível inválido ou % fora de escala | —, sem preenchimento | Nunca mostrar 0% por falta de leitura. |

O original divide níveis até 4 por 4 e trata 5 como 100%; portanto mostra 3 como 75%. A escala documentada 0–5 fundamenta 60%, em vez de repetir essa regra incorreta. As barras mantêm o verde e a apresentação do ícone original, com preenchimento fracionário: 60% corresponde a duas barras completas e 40% da terceira, entre quatro barras. A soma do preenchimento das quatro barras dividida por quatro corresponde exatamente ao percentual exibido. As barras falsas dos campos em V foram removidas; a tensão continua explícita.

## Extremos dos gráficos

Restaurados os marcadores do original: mínimo azul #22a9d6 e máximo laranja #ff6842, formato de pino acima da coordenada, rótulo com até uma casa decimal como no original. A faixa de extremos conserva unidades e precisão dos valores; tooltip/foco identifica data e horário em America/Sao_Paulo. Pinos iguais no mesmo timestamp ficam lado a lado, sem esconder um deles. Eixos incluem os extremos reais e usam escala temporal numérica para aceitar timestamps que não pertencem aos pontos reduzidos.

Aplicação: Ambiente externo (temperatura, sensação, ponto de orvalho, umidade e VPD), Ambiente interno, Solar/UV, velocidade/rajada de vento, Pressão e Bateria (tensão). Distância de raios conserva a faixa de mínimo/máximo, sem acrescentar pinos que o original não tinha. Direção de vento não recebe mínimo/máximo linear de graus. Chuvas/acumuladores não recebem os marcadores excluídos no original: não somar contadores, confundir reset com mínimo meteorológico nem inferir eventos de dados ausentes. Contagem de raios também não vira extremo de distância.

A resposta de histórico fornece `chartExtrema`, independente da redução das séries para desenho. SQLite: estatísticas diárias calculadas pelo sincronizador único sobre os registros numéricos válidos normalizados; armazenam mínimo, máximo e seus timestamps (primeira ocorrência em empate). Consultas agregam dias civis completos e leem registros brutos apenas nos dias parciais de borda, respeitando o intervalo exato. Campos high/low são considerados; seus horários são identificados como registros agregados da origem quando determinam o extremo, não como hora exata de um evento não informada. VPD em inHg é convertido para kPa também nos extremos.

A média continua identificada como média da série desenhada, independente dos extremos observados. A comparação /confere usa comparisonExtrema, calculados sobre os payloads completos na mesma resolução selecionada em cada fonte, antes da redução para desenho. Ela não mistura os extremos de todas as observações mais detalhadas (chartExtrema do histórico normal) com extremos de médias diárias da API. Não dispara chamadas adicionais para calcular extremos. Períodos arquivados normais continuam SQLite exclusivo, sem Ecowitt. Trocar grupo reaproveita os extremos por variável; trocar período/data oculta extremos antigos até a resposta correspondente ou cache válido chegar.

## Verificações de implementação

Testes de regras de bateria, extremos em SQLite controlado, limites de dias parciais, high/low, registro zero válido, ausência/NaN, valores constantes, retomada após falha/interrupção e recuperação idempotente aprovados. TypeScript e build aprovados. Testes Chrome isolado 1440×1000 e 390×844 verificaram percentual/preenchimento, ausência de overflow, marcadores não cortados, lacunas, vazio, constantes e troca de período/cache.

Teste Node 22 na cópia SQLite da VPS: 18 variáveis de extremos; todos os valores e timestamps conferidos em registros do banco, nos períodos semanal, mensal e anual. Primeiras consultas do componente de extremos: aproximadamente 429, 100 e 614 ms, respectivamente, sob limite de CPU 35%; consultas em cache 0,04–10,31 ms. Esses números medem a rotina isolada; os tempos HTTP da implantação devem ser registrados no relatório final.

Recuperação isolada com cinco janelas reais: zero perdas, zero mudanças de valores válidos e integrity_check=ok. Geração das estatísticas em cópia: 39.169 linhas com todos os timestamps preenchidos; pico de memória 149,9 MB. Backup e reversão em `/opt/clima2-antaisolar/backups/audit-20261006T113100Z`.

A atualização dos dados atuais usa cache de no máximo 45 segundos no cliente e consulta sem cache HTTP; assim o timer de 60 segundos efetivamente consulta leituras atuais. O botão Atualizar também ignora cache HTTP. Os períodos arquivados mantêm cache independente e SQLite exclusivo.
