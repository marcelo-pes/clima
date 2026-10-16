# Dados Atuais: remoção da barra e atualização de sessões com cache

A nova conferência de clima e clima2 confirmou que o componente dinâmico
`history-window` já estava removido da fonte publicada e dos bundles pelo
commit `d4ce10ef9e499978a09e8e5a221e1cb3533d7398`. Nenhuma data específica é
usada para decidir a remoção. O elemento e seu espaço deixam de existir.

Foi identificada uma possibilidade de reaparecimento em sessões antigas:
o service worker ainda usava o cache `bauru-sul-v1`, e sua busca de arquivos
podia reutilizar JavaScript guardado no cache HTTP do navegador. A alteração
anterior modificou alguns arquivos de referências sem mudar todos os seus
nomes. Uma sessão com esses arquivos antigos pode executar o componente antigo.
Não foi inspecionado o cache da sessão particular do usuário.

`public/sw.js` agora usa `bauru-sul-no-history-window-v2`. Na ativação, a limpeza
existente elimina o cache anterior. Documentos, JavaScript e CSS da própria
origem são revalidados com `cache: "no-cache"`, evitando reutilizar código
antigo apenas por ainda estar dentro da validade no cache HTTP. O fallback
offline é preservado. Chamadas `/api/` continuam fora da interceptação.
Não há navegação forçada das páginas abertas.

## Publicação

Atualizados somente `public/sw.js`, `dist/client/sw.js` nos dois serviços e
`repository/public/sw.js` no checkout existente do clima2. Sem alteração de
gráficos, filtros, dados, cálculo de extremos, banco ou coleta.

Backups anteriores à publicação:

- `/opt/clima-antaisolar/backups/current-banner-cache-20261016T175747Z`
- `/opt/clima2-antaisolar/backups/current-banner-cache-20261016T175747Z`

Cada serviço foi reiniciado e sua rota `/sw.js` foi comparada com o arquivo
novo. O JavaScript passou por `node --check`; `git diff --check` aprovado.

## Verificações

Um teste de integração em Chrome aqueceu o cache com uma versão antiga de
JavaScript marcada `max-age=31536000, immutable`, contendo uma barra dinâmica.
Após atualizar o service worker e recarregar a página, verificou:

- Barra: uma antes, zero depois.
- Cache `bauru-sul-v1` eliminado; JavaScript revalidado na rede.
- Filtro e dois marcadores mantidos no cenário de teste.

O relatório `current-banner-public-qa-20261016.json` registra a conferência
real de Dados Atuais nos dois domínios, em desktop (1440 px) e celular
(390 px), na primeira visita e após recarregar com o service worker ativo.

Todas as oito visitas passaram: zero barras e zero textos antigos, 10 gráficos,
34 marcadores e um filtro de período por visita. Nenhum erro de página foi
registrado. As duas APIs públicas responderam com 30 métricas e leituras atuais.
SHA256 do service worker servido em ambos os domínios:
`605090f15abdd0cc963c984dfd9a4307de6ffc7ce8874d5db9b3bd3838ae2862`.
