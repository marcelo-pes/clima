# Aba inicial Previsão — 19/10/2026

Ao abrir clima ou clima2, a aba Previsão deve ser selecionada, inclusive quando o endereço contém uma aba salva como `#current`. O estado inicial já era `map`, mas o efeito de montagem restaurava a aba do fragmento da URL. Agora a montagem normaliza o fragmento para `#map`, preservando caminho e parâmetros de consulta. Os cliques entre abas continuam usando o controlador existente.

Alteração pontual em `app/weather-dashboard.tsx`. Como a fonte GitHub difere da produção, o frontend publicado foi atualizado pelo aplicador `scripts/default-forecast.py`, sem substituir a implantação por um build de uma fonte antiga. O aplicador também atualiza as fontes efetivas dos dois serviços e o checkout adicional do clima2. CSS, painéis, APIs, banco e coleta não recebem alterações.

## Publicação

- Serviços `clima-antaisolar` e `clima2-antaisolar`, ambos ativos após publicação.
- Backups finais em `/root/CLIMA/Clima/backups/forecast-start-20261019T163414Z` e `/root/CLIMA/Clima2/backups/forecast-start-20261019T163414Z`.
- A tentativa inicial foi interrompida por falta de memória na VPS. O aplicador foi ajustado para processar um arquivo por vez e limitar a memória do verificador JavaScript. A retomada concluiu os dois serviços e validou também os arquivos já processados.
- Assets com sufixo `-forecast-start20261019`; mantidos os assets anteriores, também com a correção. O service worker existente revalida código na rede.
- Conferência final em modo de simulação: zero arquivos pendentes em ambos os serviços.
- Ambos os domínios continuam utilizando o frontend do clima2; roteamento preservado.

## Validação

- Parser/transpilação TSX aprovado; `git diff --check` aprovado.
- JavaScript alterado validado com `node --check` na VPS; inicial de cada serviço respondeu HTTP 200.
- Testes públicos e resultados em `default-forecast-qa-20261019.json`.
- Roteiro reproduzível: `scripts/default-forecast-public-qa.mjs` (requer Playwright e Chrome; aceita `CHROME_PATH` e `QA_OUTPUT`).
- Não foi executado build completo da fonte GitHub, por divergências preexistentes em relação à produção.

Resultado final: quatro cenários (dois domínios × larguras 1440 e 390 px), cada um com três aberturas novas (`/`, `/#current`, `/#profile`), navegação pelas seis abas e recarregamento a partir de Dados Atuais. As 16 aberturas/recarregamentos selecionaram Previsão; as 24 trocas de aba passaram. Zero erros de página. Capturas de Previsão em desktop e celular inspecionadas, com a disposição existente preservada.
