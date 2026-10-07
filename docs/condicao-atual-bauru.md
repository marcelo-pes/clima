# Fonte da condição atual de Bauru

O site apresenta a condição observada e a previsão separadamente. A previsão continua sendo fornecida pela integração de previsão já existente.

## Fonte principal e alternativa

A consulta atual do Climatempo é `weatherNow?idlocale=6655`, validada para Bauru (cidade 406, localidade 6655). O JSON retornou uma coleta recente (`fetchedAt`), porém manteve `date=06/10/2026` e `dateUpdate=00:44:00`; o horário foi normalizado como UTC e preservado como `2026-10-06T00:44:00Z` (`05/10/2026 21:44` em Brasília). Consulta sem cache local e com cabeçalhos de revalidação continuou devolvendo esse mesmo horário antigo. A idade é calculada a partir da observação, nunca do instante da consulta.

Quando o Climatempo não traz observação válida com até 65 minutos, o backend consulta o feed METAR do Aviation Weather Center/National Weather Service dos EUA para a estação aeroportuária **SBBU (Bauru)**:

`https://aviationweather.gov/api/data/metar?ids=SBBU&format=json&taf=false`

A API lista METARs como observações de terminal com cobertura mundial e recomenda identificar um User-Agent e limitar a frequência. O backend limita a consulta a uma estação e mantém cache de cinco minutos. A observação usa `reportTime` do METAR (ISO 8601, UTC), nunca `receiptTime`/horário de busca. O dado só é atual quando não está no futuro e tem no máximo 65 minutos.

O parser utiliza apenas códigos meteorológicos presentes (`TS` tempestade; `RA`/`DZ` precipitação; `FG`/`BR` neblina) e cobertura de nuvens (`OVC`/`BKN` nublado/encoberto; `SCT`/`FEW` parcialmente nublado; `CLR`/`SKC`/`NSC`/`NCD` limpo). Se o METAR não trouxer um código de tempo ou cobertura reconhecível, a condição permanece indisponível. O fundo diurno/noturno é escolhido pelo nascer/pôr do sol local em Bauru, fuso `America/Sao_Paulo`.

Uma observação fresca do Climatempo continua preferida. Caso esteja vencida, uma observação SBBU fresca é usada com sua própria origem e horário. Se nenhuma fonte estiver atualizada, a interface mantém o aviso de desatualização/indisponibilidade e não escolhe uma imagem de condição.

## Estação Ecowitt

O resumo do cabeçalho descreve apenas as leituras e regras locais da estação Ecowitt. Ele é rotulado explicitamente como “Ecowitt” e não representa o estado do Climatempo ou do METAR. Temperatura, chuva, vento e demais leituras permanecem como observadas pela estação; não são substituídas pelo METAR.

Referências: [documentação oficial do Data API do Aviation Weather Center](https://aviationweather.gov/data/api/) e [descrição oficial do produto METAR](https://aviationweather.gov/help/data/).
