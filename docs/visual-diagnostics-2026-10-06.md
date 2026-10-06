# Diagnósticos apenas no /confere — 06/10/2026

Publicada alteração exclusivamente visual no clima2, commit `16296906fb33bf0b46508603ac77ae564e99eab6`, às **13:50:40 UTC / 10:50:40 America/Sao_Paulo**.

Removidos da renderização do painel público o bloco “Extremos e cobertura dos registros disponíveis no SQLite” e o aviso “Cobertura parcial. Ausências não equivalem a zero; a sincronização é independente desta consulta.” Removido também o aviso equivalente dentro da sequência de gráficos em Dados Atuais. Os elementos não são renderizados, portanto suas margens e espaços também desaparecem.

O componente de estatísticas foi preservado e disponibilizado no painel SQLite do /confere, mantendo a consulta sob demanda ao expandir. O aviso técnico de cobertura parcial também permanece no /confere. Nenhuma mudança no backend, cálculos, pinos, consultas SQLite, sincronizador, dados ou regras de ausência. Direção circular, acumuladores, high/low e os demais tratamentos anteriores foram preservados.

TypeScript e build de produção aprovados. Testes Chrome com dados parciais em 1440×1000 e 390×1000: Dados Atuais, Histórico e Ventos × semanal/mensal/anual, seis abas, ausência dos blocos/avisos no painel principal, extremos presentes, sem overflow ou erros. /confere conserva vinte gráficos e um bloco de diagnóstico SQLite. Testes repetidos na URL pública após a implantação; evidências visual-diagnostics-local-tests.json e visual-diagnostics-public-tests.json no diretório QA, com cópias em docs/.

Backup imediato e gzip validados: `/opt/clima2-antaisolar/backups/visual-diagnostics-20261006T135037Z/code-before.tar.gz`; rollback-code.sh no mesmo diretório restaura exatamente o código anterior, sem tocar no SQLite. Registro de publicação anterior preservado no backup. SHA256 do artefato: `e103c27f716da6fa61e4b23a4477481a013baf50b5e2fb5a7406d9b7f875961b`. Original, DNS e visibilidade preservados. Não foi necessária nenhuma escrita no banco.
