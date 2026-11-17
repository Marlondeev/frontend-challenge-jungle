# Arquitetura

## Limites da solução

Kurio é uma SPA Vite/React com contratos REST tipados. A apresentação não importa fixtures: páginas usam hooks de TanStack Query e um cliente Axios. MSW intercepta as requisições na camada de rede, tanto em desenvolvimento quanto no build de demonstração. O banco é local ao navegador; não existe um servidor de produção de autenticação, pagamento ou blockchain.

| Diretório        | Responsabilidade                                                        |
| ---------------- | ----------------------------------------------------------------------- |
| `src/app`        | Router, providers, rotas protegidas e carregamento por rota             |
| `src/domain`     | Contratos de NFT, conta, carrinho, cotação, pedido e eventos            |
| `src/lib`        | Axios, autenticação, queries, mutações, cálculo decimal e reconciliação |
| `src/features`   | Catálogo, detalhe, conta, carrinho, checkout e demonstração             |
| `src/components` | Layout e primitivas acessíveis com Radix/shadcn                         |
| `src/mocks`      | Banco persistente, REST, falhas e transporte Socket.IO                  |
| `tests`          | Regressões de domínio, rede, jornadas e comparação visual               |
| `public/assets`  | WebP responsivos e WOFF2 locais com licenças                            |

TanStack Router mantém busca, filtros, ordenação, aba e página na URL. Histórico e refresh restauram esse estado. As páginas de conta/compra são carregadas sob demanda. Query administra estado remoto; formulários mantêm apenas edições locais e tentativas ainda não resolvidas.

## Rede e persistência

O Axios usa `/api`, timeout de 8 segundos e os cabeçalhos `X-Visitor-Id` e `Authorization: Bearer <token>`. O contrato de erro é `{ message, code, fields?, details? }`. Os handlers MSW delegam ao mesmo domínio usado nos testes Node. O cenário selecionado altera latência/resposta no handler, sem atalhos de sucesso na interface. `/api/__control` continua acessível em falhas para permitir recuperação e reset.

| Método e recurso                                                             | Comportamento                            |
| ---------------------------------------------------------------------------- | ---------------------------------------- |
| `GET /api/nfts`, `GET /api/nfts/:id`                                         | Catálogo com filtros/paginação e detalhe |
| `GET /api/session`                                                           | Sessão atual ou visitante                |
| `POST /api/session/login`, `/register`, `/logout`                            | Autenticação, cadastro e encerramento    |
| `GET /api/cart`                                                              | Carrinho do visitante/usuário            |
| `POST /api/cart/items`                                                       | Adição por NFT/edição/quantidade         |
| `PATCH /api/cart/items/:id`, `DELETE /api/cart/items/:id`                    | Alteração/remoção                        |
| `PUT /api/cart/coupon`                                                       | Aplicar ou remover cupom                 |
| `GET /api/favorites`, `POST /api/favorites/:id`, `DELETE /api/favorites/:id` | Favoritos privados                       |
| `GET /api/profile`, `PATCH /api/profile`, `PATCH /api/profile/password`      | Perfil/avatar/senha                      |
| `GET /api/wallets`, `POST /api/wallets`, `PATCH /api/wallets/:id`            | Carteiras privadas                       |
| `POST /api/quote`                                                            | Snapshot revalidado de itens e totais    |
| `POST /api/orders`                                                           | Criar/recuperar compra idempotente       |
| `GET /api/orders/:id`, `GET /api/orders/by-key/:key`                         | Consultar pedido do usuário autenticado  |
| `GET /api/__control`, `POST /api/__control`                                  | Cenário, reset e eventos determinísticos |

O estado persistido contém fixtures e alterações por identidade. Senhas usam PBKDF2 com salt; tokens são opacos e expiram. Isso permite avaliar o fluxo, sem transformar localStorage em um mecanismo de segurança adequado a um serviço real. No backend real, senhas e sessões devem permanecer no servidor e tokens devem usar uma estratégia apropriada ao modelo de ameaça.

## Sessão e cache

Chaves públicas: `['catalog', search]`, `['nft', id]`. Chaves privadas incluem a identidade: `['cart', owner]`, `['favorites', owner]`, `['wallets', owner]`, `['order', owner, id]` e `['quote', owner, cartVersion, coupon]`. Login, logout e expiração cancelam/removem consultas privadas. Mutações conferem a identidade atual antes de publicar respostas tardias. O interceptor 401 só expira a sessão quando o token da requisição ainda é o token ativo.

Favoritos atualizam o cache antes da resposta e restauram o valor anterior quando há falha. Catálogo mantém a lista anterior durante filtros enquanto a consulta mais recente está pendente e cancela requisições obsoletas. Carrinho e cotação são reconciliados após mutações e eventos.

Consultas usam 20 segundos de validade e 5 minutos de retenção por padrão, com atualização ao focar a janela. Falhas transitórias recebem no máximo uma repetição; 401, 403, 404, 409 e 422 não são repetidos. Mutações não têm retry automático. Sessão usa 15 segundos de validade, consulta periódica a cada 30 segundos e nenhuma repetição automática; a validade do token no mock é de uma hora.

## Transporte em tempo real

O cliente `socket.io-client` conecta a `https://realtime.kurio.test` por WebSocket. MSW intercepta o endereço e `@mswjs/socket.io-binding` adapta handshake e frames ao protocolo Socket.IO; nenhum servidor externo recebe essa conexão. A versão 0.2.0 do binding precisa de heartbeat explícito no mock. O módulo do cliente é importado depois de instalar a interceptação, porque o Engine.IO captura o construtor WebSocket na inicialização.

Os eventos `nft.updated` e `order.updated` usam `{ eventId, resourceId, version, payload }`. `VersionGate` compara a versão com REST/cache e com o último evento aceito, mantém um histórico limitado de identificadores e protege estados terminais de pedidos. Atualizações de NFT reconciliam catálogo, detalhe, carrinho e cotação. Atualizações privadas verificam a identidade no mock e no cliente. Após reconexão, recursos ativos são invalidados e consultados por REST; a assinatura anterior é removida na troca de identidade. Pedidos pendentes também têm consulta de recuperação periódica.

O transporte é intencionalmente limitado ao WebSocket textual usado nesta demonstração: não testa fallback por polling, anexos binários ou uma infraestrutura distribuída Socket.IO. Dados simulados e assinaturas pertencem à instância da aplicação; o mock não representa sincronização multiaba ou entre dispositivos.

## Compra e precisão

Valores monetários trafegam como strings. Aritmética converte ETH para BigInt com 18 casas decimais, incluindo subtotal, desconto, taxa e total. Quantidades são inteiras e o estoque pertence à edição.

A cotação registra itens e preços, validade e uma impressão do carrinho/estoque. Antes de confirmar, a interface revalida carrinho e cotação. Alterações pedem nova revisão. A revisão de transporte da cotação não é confundida com alteração comercial: `fingerprint` e versão do carrinho determinam a necessidade de revisar novamente.

Uma chave de idempotência é persistida antes do POST. O servidor associa a chave ao usuário e à intenção; repetições recuperam o mesmo pedido e conteúdo diferente com a mesma chave retorna conflito. No cenário de timeout, o pedido é criado antes de a resposta ultrapassar o timeout do Axios. A interface consulta por chave antes de tentar novamente, inclusive após refresh.

O pedido contém snapshots de itens, valores, carteira/rede e dados do colecionador. Atualizar perfil, preço do catálogo ou carteira posteriormente não altera o comprovante. Uma tentativa pendente mantém seu conteúdo original até recuperação; dados de outro usuário não são recuperados pela interface nem autorizados pela API.

O contrato de criação é `PlaceOrderInput`: `{ quoteId, walletId, idempotencyKey, collector, provider }`. O mesmo identificador segue no header `Idempotency-Key`. `collector` contém `displayName`, `username`, `email`, `ens` e `note`; o servidor valida e normaliza os textos. Clientes anteriores podem omitir `collector`/`provider`, caso em que o perfil e o provedor da carteira são copiados. Essa compatibilidade não altera recibos já persistidos. Recibos anteriores sem esse snapshot continuam legíveis.

Erros REST usam `{ message, code, fields?, details? }`, com HTTP 401 para sessão inválida, 403 para recurso privado de outro usuário, 404 para inexistente, 409 para conflito de estado/idempotência e 422 para validação. A interface associa `fields` aos controles e mantém uma mensagem geral quando necessário.

## Interface, referência e acessibilidade

Tokens principais: fundo `#140D0A`, superfície `#241612`, destaque `#D28A4C`, texto `#F7F3EC` e secundário `#CFB28C`. Roboto Mono é a fonte principal; Inter aparece nos textos editoriais do desenho. As quatro artes de 1254×1254 foram convertidas para WebP 96/320/640/960, mantendo os originais no acervo offline.

Desktop segue a composição do PDF; mobile usa suas composições específicas. Perfil, carteiras e recibo recebem adaptação mobile porque o PDF só contém desktops dessas páginas. Contagens e totais usam dados consistentes, e estados sem referência visual reutilizam os mesmos tokens. Fluxos auxiliares fora do teste não fingem integração real.

No checkout, rede e endereço vêm da carteira cadastrada; o provedor escolhido representa a conexão simulada e integra o pedido. O formulário evita duplicar edição de endereços e mostra os dados efetivamente usados. O mobile mantém as opções de provedor do PDF e oferece os dados do colecionador em uma seção recolhível, com abertura automática em erros e exibição na revisão. A gestão de carteiras usa cartões salvos e editor dedicado em vez dos dois formulários sempre expandidos do PDF. Esses ajustes dão suporte aos estados e validações exigidos pelo enunciado.

Há labels associados, erros por campo, foco visível, link para pular ao conteúdo, diálogos com captura/restauração de foco, feedback `aria-live` e suporte a movimento reduzido. Skeletons preservam a geometria de cards, carrinho e cotação. O limite de quantidade é validado novamente no servidor simulado.

## Evidências e publicação

Testes de domínio cobrem precisão, isolamento, estoque, idempotência, imutabilidade e versões. Testes de rede usam os handlers reais MSW. Playwright cobre os doze grupos do desafio em desktop/mobile, incluindo falhas e recuperação, além da geometria de tablet e regressões visuais das quatro páginas principais.

Validação final de 17/11/2026: **42 testes unitários/de rede e 70 E2E passaram**, assim como lint e build com TypeScript. A rodada integral no build de produção usou um worker, terminou em 6 minutos e registrou zero falhas, retries ou skips. As oito regressões visuais passaram sem atualização de snapshots durante essa rodada. O [HTML completo](reports/e2e/index.html) está versionado; os traces são retidos automaticamente quando há falhas.

### Lighthouse

Foram executadas três medições por página/perfil, em build otimizado com todos os assets, fontes, mocks e funcionalidades. Os [12 relatórios HTML/JSON](lighthouse/reports/SUMMARY.md) e o [ambiente completo](lighthouse/reports/summary.json) estão versionados. Ambiente: Windows build 26300 x64, Intel i5-13420H, 24 GiB, Node 24.15.0, Playwright 1.65.1, Chromium 159 e Lighthouse 13.6.0; perfis padrão de simulação mobile/desktop, navegador novo por medição.

| Página  | Perfil  | Performance | Acessibilidade | Boas práticas | SEO | LCP ms |    CLS | TBT ms |
| ------- | ------- | ----------: | -------------: | ------------: | --: | -----: | -----: | -----: |
| Início  | Mobile  |          58 |            100 |           100 | 100 |   4230 |      0 |   3857 |
| Início  | Desktop |          99 |            100 |           100 | 100 |    880 | 0,0080 |     40 |
| Detalhe | Mobile  |          59 |            100 |           100 | 100 |   3879 |      0 |   2046 |
| Detalhe | Desktop |          99 |            100 |           100 | 100 |    991 |      0 |      0 |

As metas de acessibilidade, boas práticas e SEO foram atendidas. **Performance mobile permanece abaixo de 90.** As maiores contribuições são TBT e a descoberta do LCP depois da inicialização da SPA/MSW. Perfis e traces de diagnóstico mostraram tarefas longas sem atribuição a função JavaScript, sobrepostas ao trabalho de renderização/GPU. Isso é evidência de espera nessa etapa; não comprova uma causa específica de driver nem permite atribuir todo o resultado ao ambiente. O caminho crítico ainda carrega o runtime da aplicação e da simulação antes dos dados/imagens dependentes da API. Essa limitação está aberta e não foi escondida por remoção de recursos ou mudança do perfil da auditoria.

Foram corrigidas causas verificadas: margens do skeleton que colapsavam pelo `main`, rodapé inicialmente visível e depois deslocado, reutilização do mesmo elemento DOM entre skeleton e conteúdo, consulta ampla desnecessária antes da categoria do NFT e `sizes` de imagens superestimados. O CLS de detalhe desktop caiu de aproximadamente 0,49 para 0. Os problemas de hierarquia de títulos, região de notificações e contraste foram corrigidos; o texto escuro no cobre tem contraste de 6,85:1 (mínimo 5,48:1 no gradiente). Tailwind agora examina apenas `src/`, evitando que as classes dos relatórios aumentem o CSS publicado.

Observação menor da revisão: em páginas mobile curtas, uma regra global prevalece sobre a reserva de altura mobile e subtrai 72 px de `min-height`, embora o cabeçalho esteja oculto. Não houve perda de conteúdo ou overflow; o alinhamento dessa reserva permanece como ajuste menor, separado das metas de performance não atingidas.

A aplicação é um build estático. O host precisa de HTTPS, `mockServiceWorker.js` no mesmo origin e fallback SPA para acesso direto a `/nft/:id`, `/account` e `/order/:id`. Nenhum segredo é necessário no frontend. O acervo de design, estados do navegador e arquivos temporários ficam fora do pacote publicado.

A publicação externa e o link do repositório permanecem pendentes. O código e o build estão locais; a revisão automática de aprovação bloqueou o envio à hospedagem Sites por falta de autorização explícita para esse destino. Nenhuma versão da aplicação foi enviada ou publicada, e o teste não foi entregue ao recrutador.
