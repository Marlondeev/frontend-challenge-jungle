# Kurio — Frontend Challenge

Marketplace de NFTs desenvolvido para o [desafio da Jungle Gaming](https://github.com/junglegaming/frontend-challenge), a partir do Figma e do PDF fornecidos. A interface usa as quatro artes originais e fontes locais. Compras, carteiras e autenticação são simuladas por MSW; não há pagamento ou conexão com blockchain real.

## Executar

Requisitos: Node.js 24 e npm. As versões das dependências estão fixadas no lockfile.

```sh
npm ci
npm run dev
```

Acesse `http://localhost:5173`. Em PowerShell com scripts bloqueados, use `npm.cmd` e `npx.cmd` nos comandos. Nenhuma chave externa é necessária. O Service Worker exige localhost ou HTTPS.

As opções de `.env.example` já são os padrões: `VITE_MOCKS=true` ativa o MSW e `VITE_DEMO_TOOLS=true` mostra o painel de cenários. Ambas podem ser desativadas com `false` em `.env.local`. A entrega de demonstração mantém as duas ativas; desativar os mocks exige implementar os mesmos contratos em um backend próprio.

```sh
npm run build
npm run preview
```

O build estático fica em `dist/`. Os mocks permanecem ativos no build de demonstração. Os arquivos incluídos seguem as instruções oficiais de fallback SPA da [Vercel](https://vercel.com/docs/frameworks/frontend/vite#using-vite-to-make-spas) e da [Netlify](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/#history-pushstate-and-single-page-apps).

## Experimentar os fluxos

| Conta                     | Senha       |
| ------------------------- | ----------- |
| `colecionador@kurio.test` | `Kurio123!` |
| `nova@kurio.test`         | `Kurio123!` |

É possível criar outras contas. O cupom `KURIO10` concede 10% de desconto. Cada conta possui dados próprios; o carrinho visitante é mesclado no login, respeitando o estoque.

Os botões Google e Facebook abrem uma confirmação de **login de demonstração**: Google usa o perfil fictício Colecionador, e Facebook usa Nova. A confirmação cria uma sessão normal do mock, com persistência e mesclagem do carrinho visitante. Nenhuma conta externa é acessada. Para os requisitos de uma integração real, consulte [docs/social-login.md](docs/social-login.md).

- `/`: busca, coleções, rede, preço, abas, ordenação e paginação combinados na URL.
- `/nft/emerald-ape-042`: galeria, edição, quantidade, favoritos e compra.
- `/cart`: quantidades, remoção, cupom e totais calculados.
- `/checkout`: dados do colecionador, carteira, conexão simulada, revalidação e revisão da compra.
- `/order/:id`: pedido pendente, recusado ou confirmado e comprovante do snapshot.
- `/login`, `/register`, `/account`, `/account/wallets`, `/favorites`: conta e coleção.

Use **Demonstração**, no canto inferior, para escolher lentidão, indisponibilidade, erros de validação, sessão expirada, cupom inválido/expirado, preço alterado, estoque esgotado, pagamento recusado e timeout após criação do pedido. O mesmo painel interrompe/restaura o Socket.IO e envia eventos duplicados ou antigos.

**Restaurar demonstração** apaga o banco simulado deste navegador e recupera as fixtures. As contas, sessões, carteiras, favoritos, carrinhos e pedidos persistem em localStorage; rascunhos e tentativas de compra ficam em sessionStorage e são vinculados ao usuário. Cada navegador tem seu banco independente.

Para reproduzir recuperação de compra, adicione um NFT, entre e abra o checkout; selecione **Pagamento com resposta atrasada** antes de confirmar. O servidor simulado cria o pedido antes de atrasar a resposta. A interface recupera essa mesma tentativa pela chave de idempotência. Para tempo real, mantenha o Emerald Ape no carrinho e use **Alterar preço**; para rollback, selecione **Falha ao favoritar** e tente alterar um favorito.

## Validação

```sh
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run test:visual
npm run audit
```

Playwright usa Chromium em desktop 1440×1000 e mobile 390×844, com um worker. A verificação de tablet usa 768 px. As jornadas passam pela interface e pela camada de rede MSW, incluindo o cliente real Socket.IO. Para abrir o relatório: `npx playwright show-report`. Traces e capturas de falhas ficam em `test-results/`; o relatório HTML fica em `playwright-report/`.

Por padrão, Playwright inicia o servidor de desenvolvimento. Para testar o build, execute `npm run build` e mantenha `npm run preview` em outro terminal; defina `PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173` antes dos testes. Com essa opção, o servidor informado é usado diretamente. Em PowerShell:

```powershell
$env:PLAYWRIGHT_BASE_URL = "http://127.0.0.1:4173"
npm.cmd run test:e2e
```

As oito baselines em `tests/e2e/visual.spec.ts-snapshots/` foram conferidas contra o PDF e capturadas no Windows com o Chromium do Playwright fixado no lockfile. As comparações são executadas por padrão. Mudanças intencionais exigem revisão visual antes de `npm run test:visual -- --update-snapshots`; outro sistema operacional pode exigir baselines próprias por diferenças de rasterização. Não atualize snapshots para ocultar regressões.

Validação final de 17/11/2026: **56 testes unitários/de rede e 100 E2E passaram**, incluindo as oito comparações visuais. A rodada E2E usou o build de produção, um worker e nenhum retry/skip. Lint, verificação de tipos e build também passaram. As regressões adicionais cobrem seleção do header, posição da tela nos filtros, retorno ao mercado, tamanho da arte no carrinho, rascunhos/avatar, edição de ENS e login social de demonstração com cancelamento seguro. Duas baselines foram atualizadas após revisão das mudanças intencionais de galeria e espaçamento; a rodada completa comparou sem atualizar snapshots. O [relatório HTML completo](reports/e2e/index.html) está incluído; abra com `npx playwright show-report reports/e2e`.

O comando de auditoria exige um build prévio e executa Lighthouse três vezes em início/detalhe e mobile/desktop, usando um Chromium novo por medição. Relatórios HTML/JSON, medianas, LCP, CLS, TBT e informações do ambiente ficam em `lighthouse/reports/`. As metas são 90/95/95/90 para Performance/Acessibilidade/Boas práticas/SEO. Resultados e eventuais desvios são documentados em [ARCHITECTURE.md](ARCHITECTURE.md).

A auditoria inicia seu próprio preview na porta 4173. Se já houver um preview aberto, use `AUDIT_BASE_URL=http://127.0.0.1:4173`; em PowerShell, defina `$env:AUDIT_BASE_URL` antes do comando.

Na auditoria da versão inicial `d5c8ddd`, as medianas foram **99 de Performance no desktop e 58–59 no mobile; 100 em Acessibilidade, Boas práticas e SEO** nos dois perfis. Esses relatórios antecedem as correções de navegação, galeria e login social. Performance mobile ficou abaixo da meta e está descrita com métricas, investigação e limitações em [ARCHITECTURE.md](ARCHITECTURE.md). Consulte o [resumo dos 12 relatórios](lighthouse/reports/SUMMARY.md).

## Decisões e referências

A arquitetura e os contratos estão em [ARCHITECTURE.md](ARCHITECTURE.md). O projeto usa React, TypeScript, TanStack Router/Query, Axios, Tailwind, componentes shadcn/ui com Radix, MSW e Socket.IO. ETH é calculado em unidades inteiras de 18 casas com BigInt.

O arquivo Figma, PDF, imagens originais, especificações e estilos foram preservados localmente em `design-reference/`, com índice offline em `design-reference/index.html`. Esse acervo de aproximadamente 145 MB não integra o repositório da aplicação. Os assets otimizados necessários à execução e as licenças das fontes estão em `public/assets/`.

Totais, disponibilidade e contagens refletem dados consistentes da simulação, inclusive onde o PDF usa exemplos divergentes. Os estados de erro, revisão, conexão e recuperação completam os fluxos exigidos. Recuperação por e-mail e conteúdos editoriais externos exibem feedback explícito de indisponibilidade na demonstração; o login social usa perfis fictícios identificados antes da confirmação.

## Publicação

O código, build e relatórios estão locais; não há remoto Git configurado nem URL pública publicada. O envio à hospedagem Sites foi bloqueado pela revisão automática de aprovação, que exige autorização explícita para esse destino externo. O deploy obrigatório do enunciado e o link de repositório permanecem pendentes; os arquivos de configuração para Vercel/Netlify já estão incluídos.
