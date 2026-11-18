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

A faixa de preço usa dois controles nativos com passos de 0,01 ETH. O rascunho só altera a busca ao aplicar; limpar reinicia o rascunho mesmo quando a URL já está sem limites. A ordenação mantém um select nativo sobre toda a área visível, preservando teclado e opções do navegador, com texto alinhado às abas no desktop. No mobile, o mesmo controle fica dentro do painel de filtros, e a contagem de resultados usa apresentação `sr-only`; ambos continuam refletindo a busca na URL.

## Rede e persistência

O Axios usa `/api`, timeout de 8 segundos e os cabeçalhos `X-Visitor-Id` e `Authorization: Bearer <token>`. O contrato de erro é `{ message, code, fields?, details? }`. Os handlers MSW delegam ao mesmo domínio usado nos testes Node. O cenário selecionado altera latência/resposta no handler, sem atalhos de sucesso na interface. `/api/__control` continua acessível em falhas para permitir recuperação e reset.

| Método e recurso                                                             | Comportamento                                             |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| `GET /api/nfts`, `GET /api/nfts/:id`                                         | Catálogo com filtros/paginação e detalhe                  |
| `GET /api/session`                                                           | Sessão atual ou visitante                                 |
| `POST /api/session/login`, `/register`, `/logout`                            | Autenticação, cadastro e encerramento                     |
| `POST /api/session/social-demo`                                              | Sessão fictícia Google/Facebook no mock                   |
| `POST /api/session/social-demo`                                              | Sessão de perfil fictício Google/Facebook, apenas no mock |
| `GET /api/cart`                                                              | Carrinho do visitante/usuário                             |
| `POST /api/cart/items`                                                       | Adição por NFT/edição/quantidade                          |
| `PATCH /api/cart/items/:id`, `DELETE /api/cart/items/:id`                    | Alteração/remoção                                         |
| `PUT /api/cart/coupon`                                                       | Aplicar ou remover cupom                                  |
| `GET /api/favorites`, `POST /api/favorites/:id`, `DELETE /api/favorites/:id` | Favoritos privados                                        |
| `GET /api/profile`, `PATCH /api/profile`, `PATCH /api/profile/password`      | Perfil/avatar/senha                                       |
| `GET /api/wallets`, `POST /api/wallets`, `PATCH /api/wallets/:id`            | Carteiras privadas                                        |
| `POST /api/quote`                                                            | Snapshot revalidado de itens e totais                     |
| `POST /api/orders`                                                           | Criar/recuperar compra idempotente                        |
| `GET /api/orders/:id`, `GET /api/orders/by-key/:key`                         | Consultar pedido do usuário autenticado                   |
| `GET /api/__control`, `POST /api/__control`                                  | Cenário, reset e eventos determinísticos                  |

O estado persistido contém fixtures e alterações por identidade. Senhas usam PBKDF2 com salt; tokens são opacos e expiram. Isso permite avaliar o fluxo, sem transformar localStorage em um mecanismo de segurança adequado a um serviço real. No backend real, senhas e sessões devem permanecer no servidor e tokens devem usar uma estratégia apropriada ao modelo de ameaça.

O banco `kurio.mock.v1` e o token `kurio.session` são compartilhados por abas da mesma origem. Cada operação do backend recarrega o estado completo depois de adquirir o coordenador de armazenamento, antes de consultar, liquidar pedidos ou alterar dados. A inicialização/migração e os timers de pedidos usam a mesma coordenação, preservando sessões, carrinhos, estoque, perfis e registros de idempotência gravados por outra aba. O navegador aguarda a inicialização coordenada antes de instalar os handlers MSW.

Com `navigator.locks`, as seções síncronas de leitura, validação e gravação são serializadas entre abas da origem. Sem essa API, uma fila compartilhada por adaptador coordena apenas instâncias no mesmo contexto JavaScript, como os backends de teste em memória. Recarregar os dados evita sobrescritas sequenciais por cópias antigas, mas esse fallback não garante atomicidade para gravações simultâneas em abas diferentes.

A derivação de senha ocorre fora das seções coordenadas. Login, cadastro e troca de senha obtêm um snapshot, calculam o hash e recarregam o estado para validar e efetivar a operação: o cadastro confere novamente a unicidade, o login confere o usuário e a credencial atual, e a troca de senha revalida o token e a credencial original. A liquidação verifica o estado persistido do pedido antes de reduzir estoque; outro timer não reaplica uma conclusão já registrada. Leituras de cenário e autorização de socket não gravam dados nem consomem o carrinho social pendente. Durante eventos síncronos, essas leituras usam o estado da transação em andamento.

O login social é uma demonstração explícita, confirmada em diálogo antes de autenticar. O mock associa `google` a `user-collector` e `facebook` a `user-nova` por IDs estáveis; não recebe credenciais externas. A emissão de sessão e a mesclagem do carrinho usam os mesmos helpers do login por senha, que continua validando a senha. Na sessão social, o merge acontece uma única vez na primeira requisição com o token aceito; uma resposta cancelada não consome o carrinho visitante. Sessões antigas continuam compatíveis. Com `VITE_MOCKS=false`, os botões ficam indisponíveis e o cliente não chama o endpoint de demonstração. A integração OAuth real depende de aplicativos Google/Meta e de validação no servidor; os requisitos estão em [docs/social-login.md](docs/social-login.md).

## Sessão e cache

Chaves públicas: `['catalog', search]`, `['nft', id]`. Chaves privadas incluem a identidade: `['cart', owner]`, `['favorites', owner]`, `['wallets', owner]`, `['order', owner, id]` e `['quote', owner, cartVersion, coupon]`. Login, logout e expiração cancelam/removem consultas privadas. Mutações conferem a identidade atual antes de publicar respostas tardias. O interceptor 401 só expira a sessão quando o token da requisição ainda é o token ativo e o erro não é `INVALID_CREDENTIALS`. Esse código indica credenciais de login incorretas e preserva a sessão atual; os demais 401 continuam invalidando o token correspondente. O evento de armazenamento do token invalida a consulta de sessão nas outras abas, que usam o estado persistido atual para revalidar a identidade.

Favoritos atualizam o cache antes da resposta e restauram o valor anterior quando há falha. Catálogo mantém a lista anterior durante filtros enquanto a consulta mais recente está pendente e cancela requisições obsoletas. Carrinho e cotação são reconciliados após mutações e eventos.

No perfil, atualizações de avatar e sessão preservam campos editados localmente. Salvar aplica a normalização do servidor apenas aos valores que não foram editados novamente durante a requisição. Leituras de imagem são canceladas e conferem o ciclo de montagem e a identidade antes de iniciar o PATCH, evitando que um avatar antigo seja enviado com a sessão de outra conta.

Consultas usam 20 segundos de validade e 5 minutos de retenção por padrão, com atualização ao focar a janela. Falhas transitórias recebem no máximo uma repetição; 401, 403, 404, 409 e 422 não são repetidos. Mutações não têm retry automático. Sessão usa 15 segundos de validade, consulta periódica a cada 30 segundos e nenhuma repetição automática; a validade do token no mock é de uma hora.

O cenário persistido `expired-session` invalida os tokens usados nas operações autenticadas até uma nova autenticação válida. Entrar por senha, cadastrar uma conta ou confirmar a demonstração social emite uma nova sessão e retorna apenas esse cenário a `success`; os demais cenários permanecem selecionados. A ação `expire` antecipa o prazo das sessões existentes e não impede um login posterior. A verificação do prazo real, o logout e as respostas 401 continuam ativos.

## Transporte em tempo real

O cliente `socket.io-client` conecta a `https://realtime.kurio.test` por WebSocket. MSW intercepta o endereço e `@mswjs/socket.io-binding` adapta handshake e frames ao protocolo Socket.IO; nenhum servidor externo recebe essa conexão. A versão 0.2.0 do binding precisa de heartbeat explícito no mock. O módulo do cliente é importado depois de instalar a interceptação, porque o Engine.IO captura o construtor WebSocket na inicialização.

Os eventos `nft.updated` e `order.updated` usam `{ eventId, resourceId, version, payload }`. `VersionGate` compara a versão com REST/cache e com o último evento aceito, mantém um histórico limitado de identificadores e protege estados terminais de pedidos. Atualizações de NFT reconciliam catálogo, detalhe, carrinho e cotação. Atualizações privadas verificam a identidade no mock e no cliente. Após reconexão, recursos ativos são invalidados e consultados por REST; a assinatura anterior é removida na troca de identidade. Pedidos pendentes também têm consulta de recuperação periódica.

O transporte é intencionalmente limitado ao WebSocket textual usado nesta demonstração: não testa fallback por polling, anexos binários ou uma infraestrutura distribuída Socket.IO. A persistência e a sessão são compartilhadas entre abas conforme a coordenação descrita acima; as assinaturas e a entrega de eventos Socket.IO pertencem a cada instância da aplicação. Alterações feitas por outra aba são lidas nas consultas REST seguintes, sem transmissão de eventos entre abas ou sincronização entre dispositivos.

## Compra e precisão

Valores monetários trafegam como strings. Aritmética converte ETH para BigInt com 18 casas decimais, incluindo subtotal, desconto, taxa e total. Quantidades são inteiras e o estoque pertence à edição.

`Nft.defaultEditionId` permite sugerir uma edição disponível. Emerald, Sage e Neon preferem `ten`; os demais mantêm o primeiro estoque disponível. Uma seleção manual válida tem precedência, e esgotamento aciona fallback e ajuste de quantidade. Ao carregar dados antigos, o mock adiciona apenas a preferência ausente desses três exemplos, preservando estoques consumidos, versões, carrinhos e contas. Edições 1/1 continuam com estoque unitário.

A cotação registra itens e preços, validade e uma impressão do carrinho/estoque. Antes de confirmar, a interface revalida carrinho e cotação. Alterações pedem nova revisão. A revisão de transporte da cotação não é confundida com alteração comercial: `fingerprint` e versão do carrinho determinam a necessidade de revisar novamente.

Uma chave de idempotência é persistida antes do POST. O servidor associa a chave ao usuário e à intenção; repetições recuperam o mesmo pedido e conteúdo diferente com a mesma chave retorna conflito. No cenário de timeout, o pedido é criado antes de a resposta ultrapassar o timeout do Axios. A interface consulta por chave antes de tentar novamente, inclusive após refresh.

O pedido contém snapshots de itens, valores, carteira/rede e dados do colecionador. Atualizar perfil, preço do catálogo ou carteira posteriormente não altera o comprovante. Uma tentativa pendente mantém seu conteúdo original até recuperação; dados de outro usuário não são recuperados pela interface nem autorizados pela API.

O contrato de criação é `PlaceOrderInput`: `{ quoteId, walletId, idempotencyKey, collector, provider }`. O mesmo identificador segue no header `Idempotency-Key`. `collector` contém `displayName`, `username`, `email`, `ens` e `note`; o servidor valida e normaliza os textos. Clientes anteriores podem omitir `collector`/`provider`, caso em que o perfil e o provedor da carteira são copiados. Essa compatibilidade não altera recibos já persistidos. Recibos anteriores sem esse snapshot continuam legíveis.

Erros REST usam `{ message, code, fields?, details? }`, com HTTP 401 para sessão inválida ou credenciais de login incorretas (`INVALID_CREDENTIALS`), 403 para recurso privado de outro usuário, 404 para inexistente, 409 para conflito de estado/idempotência e 422 para validação. A interface associa `fields` aos controles e mantém uma mensagem geral quando necessário.

## Interface, referência e acessibilidade

Tokens principais: fundo `#140D0A`, superfície `#241612`, destaque `#D28A4C`, texto `#F7F3EC` e secundário `#CFB28C`. Roboto Mono é a fonte principal; Inter aparece nos textos editoriais do desenho. As quatro artes de 1254×1254 foram convertidas para WebP 96/320/640/960, mantendo os originais no acervo offline.

Desktop segue a composição do PDF. As seis telas mobile de início, detalhe, carrinho, pagamento, login e cadastro usam as referências de 414×896 px, com adaptação para larguras de 320, 360, 390 e 414 px. Os estilos específicos ficam no breakpoint até 767 px. Perfil, carteiras e recibo recebem adaptação mobile porque o PDF só contém desktops dessas páginas. Contagens e totais usam dados consistentes, e estados sem referência visual reutilizam os mesmos tokens. Fluxos auxiliares fora do teste não fingem integração real.

No início mobile, a busca tem 45 px e o banner 190 px na largura de referência, com arte principal de 138 px, arte sobreposta de 58 px e tipografia própria. Os cards usam painel de proporção 175:200, imagens quadradas e deslocamento de 32 px na coluna direita. Os SVGs do fundo do banner, recorte central da barra inferior e ícones foram exportados dos paths e preenchimentos do Figma arquivado para `public/assets/ui/`. Os fundos se ajustam ao contêiner sem faixas internas; círculos e ícones preservam suas proporções. A barra inferior mantém áreas clicáveis de 44 px e ação central de 65 px.

O detalhe mobile sobrepõe uma folha de informações à galeria e mantém quantidade, preço e compra em uma barra inferior. Carrinho e pagamento usam seus próprios resumos e ações; login e cadastro apresentam formulários sobre o fundo da página. A altura de referência orienta a composição, sem limitar a rolagem quando a tela é menor, o conteúdo cresce ou a validação abre campos. O botão de cenários da demonstração participa do fluxo no fim da página no mobile, enquanto no desktop permanece fixo no canto inferior. Essa revisão de apresentação reutiliza os contratos, a persistência e o ciclo de sessão existentes, sem alterações no backend simulado.

No checkout, rede e endereço vêm da carteira cadastrada; o provedor escolhido representa a conexão simulada e integra o pedido. O formulário evita duplicar edição de endereços e mostra os dados efetivamente usados. O mobile mantém as opções de provedor do PDF e oferece os dados do colecionador em uma seção recolhível, com abertura automática em erros e exibição na revisão. A gestão de carteiras usa cartões salvos e editor dedicado em vez dos dois formulários sempre expandidos do PDF. Esses ajustes dão suporte aos estados e validações exigidos pelo enunciado.

Há labels associados, erros por campo, foco visível, link para pular ao conteúdo, diálogos com captura/restauração de foco, feedback `aria-live` e suporte a movimento reduzido. Skeletons preservam a geometria de cards, carrinho e cotação. O limite de quantidade é validado novamente no servidor simulado.

Ao entrar pelo cabeçalho do carrinho, o login retorna a `/cart`; ao usar “Conectar e finalizar”, mantém `/checkout` como destino. No desktop, esses fluxos mostram o carrinho atrás do diálogo, e fechar retorna ao carrinho. A validação de redirecionamento local continua aplicada. Os controles de quantidade usam 20×30 px no desktop e 24×26 px no mobile, com símbolos centralizados e estados desabilitados nos limites de estoque.

O favorito dos detalhes usa um `AuthDialog` sobre a instância atual do NFT, mantendo a URL e os estados de edição, quantidade e galeria. O diálogo compartilha o formulário e o ciclo de cancelamento com as rotas de autenticação; seus modos são locais e os provedores sociais aceitam um callback de sucesso. O favorito pendente confere NFT, token e usuário aceito antes de usar a mutação do cache privado, sendo consumido uma vez. Fechar ou mudar de NFT descarta a intenção; a devolução de foco usa o botão que abriu a janela.

## Evidências e publicação

Testes de domínio cobrem precisão, isolamento, estoque, idempotência, imutabilidade e versões. Testes de rede usam os handlers reais MSW. Playwright cobre os doze grupos do desafio em desktop/mobile, incluindo falhas e recuperação, além da geometria de tablet e regressões visuais das quatro páginas principais.

Após a revisão das seis telas mobile, **77 testes unitários/de rede e 144 E2E passaram**, com lint, verificação de tipos e build. A rodada integral de produção usou desktop/mobile, um worker e zero falhas, retries, casos instáveis ou skips, incluindo as oito comparações visuais. As quatro baselines mobile foram revistas contra o PDF antes da rodada final, que executou as comparações sem atualizar snapshots; as comparações desktop passaram com as baselines anteriores. O [HTML integral](reports/e2e/index.html) está versionado; traces são retidos automaticamente quando há falhas.

Além das comparações automatizadas em 390 px, 18 capturas das seis telas em 414, 360 e 320 px registraram zero rolagem horizontal e erros de página. A [visão em 414 × 896 px](reports/mobile-fidelity/screens-414.png) reúne início, detalhes, carrinho, pagamento, login e cadastro. A conferência separou a composição visual dos dados reais das fixtures, preferências de edição e favoritos salvos. O controle Demonstração foi aberto e fechado por sua interface após a mudança para o final da página mobile.

Os oito casos novos de persistência em navegador verificam sessão e carrinho com uma aba anterior ao login, recarregamento, recuperação do cenário de expiração, logout entre abas e a consulta automática após 30 segundos. Quatorze regressões de backend cobrem estado antigo, coordenação, cadastro e credenciais concorrentes, bootstrap, timers e leituras reentrantes de socket; seis testes do interceptor verificam preservação da sessão após credenciais incorretas e invalidação correta de tokens expirados ou rejeitados. Os casos anteriores de catálogo, faixa de preço, ordenação, navegação, edições, perfil, autenticação, compra, tempo real e tablet também passaram.

Para o login contextual nos detalhes, o [HTML anterior com capturas desktop/mobile](reports/detail-auth/index.html) preserva uma seleção de 54 E2E de conta e autenticação. Os doze casos de diálogo confirmam contexto preservado, modos locais, foco, favorito único, cancelamento e retry, e também passaram na rodada integral atual. Os estilos das rotas de login e cadastro são separados dos diálogos, que continuam preservando a tela em que foram abertos.

### Lighthouse

Na versão inicial `d5c8ddd`, foram executadas três medições por página/perfil, em build otimizado com todos os assets, fontes, mocks e funcionalidades. Os [12 relatórios HTML/JSON](lighthouse/reports/SUMMARY.md) e o [ambiente completo](lighthouse/reports/summary.json) estão versionados. Eles antecedem as correções de navegação, galeria e login social, sem nova medição dessas alterações. Ambiente: Windows build 26300 x64, Intel i5-13420H, 24 GiB, Node 24.15.0, Playwright 1.65.1, Chromium 159 e Lighthouse 13.6.0; perfis padrão de simulação mobile/desktop, navegador novo por medição.

| Página  | Perfil  | Performance | Acessibilidade | Boas práticas | SEO | LCP ms |    CLS | TBT ms |
| ------- | ------- | ----------: | -------------: | ------------: | --: | -----: | -----: | -----: |
| Início  | Mobile  |          58 |            100 |           100 | 100 |   4230 |      0 |   3857 |
| Início  | Desktop |          99 |            100 |           100 | 100 |    880 | 0,0080 |     40 |
| Detalhe | Mobile  |          59 |            100 |           100 | 100 |   3879 |      0 |   2046 |
| Detalhe | Desktop |          99 |            100 |           100 | 100 |    991 |      0 |      0 |

As metas de acessibilidade, boas práticas e SEO foram atendidas. **Performance mobile permanece abaixo de 90.** As maiores contribuições são TBT e a descoberta do LCP depois da inicialização da SPA/MSW. Perfis e traces de diagnóstico mostraram tarefas longas sem atribuição a função JavaScript, sobrepostas ao trabalho de renderização/GPU. Isso é evidência de espera nessa etapa; não comprova uma causa específica de driver nem permite atribuir todo o resultado ao ambiente. O caminho crítico ainda carrega o runtime da aplicação e da simulação antes dos dados/imagens dependentes da API. Essa limitação está aberta e não foi escondida por remoção de recursos ou mudança do perfil da auditoria.

Foram corrigidas causas verificadas: margens do skeleton que colapsavam pelo `main`, rodapé inicialmente visível e depois deslocado, reutilização do mesmo elemento DOM entre skeleton e conteúdo, consulta ampla desnecessária antes da categoria do NFT e `sizes` de imagens superestimados. O CLS de detalhe desktop caiu de aproximadamente 0,49 para 0. Os problemas de hierarquia de títulos, região de notificações e contraste foram corrigidos; o texto escuro no cobre tem contraste de 6,85:1 (mínimo 5,48:1 no gradiente). Tailwind agora examina apenas `src/`, evitando que as classes dos relatórios aumentem o CSS publicado.

No mobile, o conteúdo principal reserva ao menos `100svh`, acompanhando o cabeçalho oculto e as ações específicas de cada tela. As métricas Lighthouse acima continuam sendo da versão inicial; a revisão visual mobile não foi submetida a uma nova auditoria de performance.

A aplicação é um build estático. O host precisa de HTTPS, `mockServiceWorker.js` no mesmo origin e fallback SPA para acesso direto a `/nft/:id`, `/account` e `/order/:id`. Nenhum segredo é necessário no frontend. O acervo de design, estados do navegador e arquivos temporários ficam fora do pacote publicado.

A publicação externa e o link do repositório permanecem pendentes. O código e o build estão locais; a revisão automática de aprovação bloqueou o envio à hospedagem Sites por falta de autorização explícita para esse destino. Nenhuma versão da aplicação foi enviada ou publicada, e o teste não foi entregue ao recrutador.
