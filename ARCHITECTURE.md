# Arquitetura

## Limites da solução

Kurio é uma SPA Vite/React com contratos REST tipados. A apresentação não importa fixtures: páginas usam hooks de TanStack Query e um cliente Axios. O modo padrão usa MSW e localStorage. `google-demo` verifica uma conta Google real por uma função Vercel stateless e mantém o marketplace fictício em sessionStorage. A variante opcional `google` usa o domínio em um servidor Node local com REST, Socket.IO e armazenamento privado persistente. Catálogo, carteiras, pagamentos e compras permanecem fictícios nos três modos; não há conexão com blockchain.

| Diretório        | Responsabilidade                                                        |
| ---------------- | ----------------------------------------------------------------------- |
| `src/app`        | Router, providers, rotas protegidas e carregamento por rota             |
| `src/domain`     | Contratos de NFT, conta, carrinho, cotação, pedido e eventos            |
| `src/lib`        | Axios, autenticação, queries, mutações, cálculo decimal e reconciliação |
| `src/features`   | Catálogo, detalhe, conta, carrinho, checkout e demonstração             |
| `src/components` | Layout e primitivas acessíveis com Radix/shadcn                         |
| `src/mocks`      | Banco persistente, REST, falhas e transporte Socket.IO                  |
| `server`         | API local do modo Google, validação de token, armazenamento e Socket.IO |
| `api`            | Node Function Vercel para verificar identidade Google sem banco         |
| `config`         | Client ID OAuth público compartilhado pelo build e pela função          |
| `tests`          | Regressões de domínio, rede, jornadas e comparação visual               |
| `public/assets`  | WebP responsivos e WOFF2 locais com licenças                            |

TanStack Router mantém busca, filtros, ordenação, aba e página na URL. Histórico e refresh restauram esse estado. As páginas de conta/compra são carregadas sob demanda. Query administra estado remoto; formulários mantêm apenas edições locais e tentativas ainda não resolvidas.

A faixa de preço usa dois controles nativos com passos de 0,01 ETH. O rascunho só altera a busca ao aplicar; limpar reinicia o rascunho mesmo quando a URL já está sem limites. A ordenação mantém um select nativo sobre toda a área visível, preservando teclado e opções do navegador, com texto alinhado às abas no desktop. No mobile, o mesmo controle fica dentro do painel de filtros, e a contagem de resultados usa apresentação `sr-only`; ambos continuam refletindo a busca na URL.

## Rede e persistência

O Axios usa `/api`, timeout de 8 segundos e os cabeçalhos `X-Visitor-Id` e `Authorization: Bearer <token>`. O contrato de erro é `{ message, code, fields?, details? }`. Os handlers MSW e a API Node local delegam ao mesmo domínio. No modo padrão, o cenário selecionado altera latência/resposta no handler, sem atalhos de sucesso na interface; `/api/__control` continua acessível em falhas para permitir recuperação e reset. O servidor da variante `google` não expõe controle ou login social fictício. Em `google-demo`, MSW atende o marketplace e deixa `/api/google-auth` passar à função real antes de aplicar cenários.

| Método e recurso                                                             | Comportamento                                                           |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /api/nfts`, `GET /api/nfts/:id`                                         | Catálogo com filtros/paginação e detalhe                                |
| `GET /api/session`                                                           | Sessão atual ou visitante                                               |
| `POST /api/session/login`, `/register`, `/logout`                            | Autenticação, cadastro e encerramento                                   |
| `POST /api/session/social-demo`                                              | Sessão de perfil fictício Google/Facebook, apenas no mock               |
| `GET /api/session/google/challenge`                                          | Desafio de nonce e cookie, apenas no servidor Google                    |
| `POST /api/session/google`                                                   | ID token Google verificado no servidor, apenas no modo Google           |
| `GET /api/google-auth`, `POST /api/google-auth`                              | Desafio e identidade verificada pela função sem banco, em `google-demo` |
| `GET /api/cart`                                                              | Carrinho do visitante/usuário                                           |
| `POST /api/cart/items`                                                       | Adição por NFT/edição/quantidade                                        |
| `PATCH /api/cart/items/:id`, `DELETE /api/cart/items/:id`                    | Alteração/remoção                                                       |
| `PUT /api/cart/coupon`                                                       | Aplicar ou remover cupom                                                |
| `GET /api/favorites`, `POST /api/favorites/:id`, `DELETE /api/favorites/:id` | Favoritos privados                                                      |
| `GET /api/profile`, `PATCH /api/profile`, `PATCH /api/profile/password`      | Perfil/avatar/senha                                                     |
| `GET /api/wallets`, `POST /api/wallets`, `PATCH /api/wallets/:id`            | Carteiras privadas                                                      |
| `POST /api/quote`                                                            | Snapshot revalidado de itens e totais                                   |
| `POST /api/orders`                                                           | Criar/recuperar compra idempotente                                      |
| `GET /api/orders/:id`, `GET /api/orders/by-key/:key`                         | Consultar pedido do usuário autenticado                                 |
| `GET /api/__control`, `POST /api/__control`                                  | Cenário, reset e eventos determinísticos, apenas no mock                |

O estado contém fixtures e alterações por identidade. Senhas locais usam PBKDF2 com salt; tokens são opacos e expiram após uma hora. Na demonstração padrão, os registros ficam em localStorage; em `google-demo`, ficam em sessionStorage apenas na aba. Esses dados fictícios no cliente não constituem um backend protegido de contas ou compras. Na variante `google`, banco, credenciais locais e sessões ficam no armazenamento privado do servidor; o navegador recebe o token da aplicação. Contas Google não possuem senha local.

Na demonstração padrão, o banco `kurio.mock.v1` e o token `kurio.session` são compartilhados por abas da mesma origem. Cada operação do backend recarrega o estado completo depois de adquirir o coordenador de armazenamento, antes de consultar, liquidar pedidos ou alterar dados. A inicialização/migração e os timers de pedidos usam a mesma coordenação, preservando sessões, carrinhos, estoque, perfis e registros de idempotência gravados por outra aba. O navegador aguarda a inicialização coordenada antes de instalar os handlers MSW. Em `google-demo`, cada aba independente tem seu próprio banco, token e visitante em sessionStorage.

Na demonstração padrão, `navigator.locks` serializa as seções síncronas de leitura, validação e gravação entre abas da origem. Sem essa API, uma fila compartilhada por adaptador coordena apenas instâncias no mesmo contexto JavaScript, como os backends de teste em memória. Recarregar os dados evita sobrescritas sequenciais por cópias antigas, mas esse fallback não garante atomicidade para gravações simultâneas em abas diferentes.

A derivação de senha ocorre fora das seções coordenadas. Login, cadastro e troca de senha obtêm um snapshot, calculam o hash e recarregam o estado para validar e efetivar a operação: o cadastro confere novamente a unicidade, o login confere o usuário e a credencial atual, e a troca de senha revalida o token e a credencial original. A liquidação verifica o estado persistido do pedido antes de reduzir estoque; outro timer não reaplica uma conclusão já registrada. Leituras de cenário e autorização de socket não gravam dados nem consomem o carrinho social pendente. Durante eventos síncronos, essas leituras usam o estado da transação em andamento.

No modo padrão, o login social é uma demonstração explícita, confirmada em diálogo antes de autenticar. O mock associa `google` a `user-collector` e `facebook` a `user-nova` por IDs estáveis; não recebe credenciais externas. A emissão de sessão e a mesclagem do carrinho usam os mesmos helpers do login por senha, que continua validando a senha. Na sessão social, o merge acontece uma única vez na primeira requisição com o token aceito; uma resposta cancelada não consome o carrinho visitante. Sessões antigas continuam compatíveis.

### Servidor Google local

`npm run dev:google`, `build:google` e `preview:google` selecionam o modo Vite `google`. `.env.google` define `VITE_MOCKS=false`, `VITE_DEMO_TOOLS=false` e `VITE_GOOGLE_LOGIN=real`. O Client ID público fica em `.env.google.local`, já configurado neste workspace e ignorado pelo Git; `.env.google.example` documenta o formato sem incluir o identificador usado. O fluxo não requer Client Secret. O build separado usa `dist-google/`, preservando `dist/` para a demonstração.

`googleApiPlugin` instala a API e Socket.IO na mesma origem do servidor local de desenvolvimento ou preview. As portas são fixas em 5173 e 4173. O servidor valida as origens locais permitidas e os limites de corpo e bloqueia acesso HTTP aos arquivos privados. Apenas um processo pode usar `tmp/google-auth/`: `writer.lock` impede escritores concorrentes, e o estado JSON é salvo por substituição atômica. O diretório é ignorado pelo Git e persiste após reiniciar; desenvolvimento e preview não devem ser executados simultaneamente usando esse mesmo banco.

O frontend carrega o SDK oficial do Google e usa `renderButton` com popup. `GET /api/session/google/challenge` gera nonce e cookie `HttpOnly`, `SameSite=Strict`, válido por cinco minutos. `POST /api/session/google` recebe somente `{ credential, nonce }`, consome o desafio uma vez e verifica o token com `google-auth-library`, incluindo assinatura, algoritmo, destinatário, emissor, prazo, e-mail verificado e nonce. Credenciais não são incluídas em logs ou mensagens de erro.

Somente o adaptador de servidor chama `backend.loginGoogle(identity, context)` depois da verificação; o dispatcher de domínio não aceita um perfil declarado pelo cliente como prova de identidade. O `sub` forma a identidade estável. O primeiro acesso rejeita conflitos de e-mail sem vincular automaticamente contas; retornos preservam perfil editado, carrinho, favoritos e carteiras. Uma nova conta Google não recebe senha ou carteira fictícia automática. O perfil explica que a senha é gerenciada pelo Google, e as APIs locais de senha recusam essa conta.

A tentativa de autenticação reserva sua geração no clique do botão, antes do retorno do popup. Cancelamento, desmontagem e uma autenticação mais recente descartam respostas tardias. O servidor confere `AbortSignal` antes de efetivar a sessão dentro da transação coordenada. O carrinho visitante só é mesclado na primeira requisição autenticada com o token aceito. Facebook permanece desabilitado nesse modo porque o aplicativo Meta não foi configurado. Configuração e operação estão em [docs/social-login.md](docs/social-login.md).

### Google hospedado sem banco

`dev:google-demo`, `build:google-demo` e `preview:google-demo` selecionam o modo Vite `google-demo`. `.env.google-demo` mantém MSW ativo, desativa ferramentas de cenários e define `VITE_GOOGLE_LOGIN=vercel-demo`. O build usa `dist/`, assim como o build padrão: é necessário gerar a variante correspondente antes do preview. `npm run build` continua produzindo o modo puramente simulado.

O Client ID público padrão está em `config/google-client.ts`, usado pelo build e por `api/google-auth.ts`. Esse identificador OAuth não é segredo. O deploy Vercel funciona sem variável de ambiente obrigatória e sem Client Secret; `VITE_GOOGLE_CLIENT_ID` pode substituir o padrão nos dois lados mediante novo deploy. O endereço informado é [frontend-challenge-jungle-delta.vercel.app](https://frontend-challenge-jungle-delta.vercel.app). Sua origem exata, `https://frontend-challenge-jungle-delta.vercel.app`, sem barra final, precisa estar autorizada no Google Cloud.

`createHostedGoogleHandler` é um handler stateless compartilhado pelo plugin local e pela Node Function Vercel. `GET /api/google-auth` fornece nonce com timestamp e cookie `HttpOnly`, `SameSite=Strict`, válido por cinco minutos. `POST` exige origem correspondente ao host, cookie e nonce compatíveis e prazo válido; `createGoogleVerifier` valida assinatura, destinatário, emissor, validade, e-mail verificado e nonce do ID token. O cookie é limpo na tentativa. Não há registro durável de desafios consumidos: trata-se de proteção stateless por cookie e nonce, sem garantia de uso único persistente.

A função retorna somente `{ identity }` e não grava usuários, sessões ou dados de compra. Após verificar a identidade, o frontend chama a ponte `loginVerifiedGoogleDemo`, que confere cancelamento e usa o backend MSW da aba para emitir o token fictício da aplicação. O AuthProvider conserva o controle de geração e os destinos de carrinho e favorito. O `sub` Google continua estável, sem vinculação automática por e-mail, senha local ou carteira automática. Facebook permanece desabilitado.

`getClientStorage` seleciona sessionStorage nesse modo para banco, perfil, token e visitante. Atualizar a aba preserva o estado; uma aba independente ou contexto novo começa anônimo. O ID token Google não é armazenado. A identidade é real, enquanto o marketplace e sua sessão são uma demonstração editável no cliente, sem API protegida de contas ou compras. Não há banco ou serviço adicional de hospedagem.

`vercel.json` usa `npm run build:google-demo`, publica `dist/` e exclui `/api/*` do fallback SPA para que a função seja executada. Headers COOP `same-origin-allow-popups` e `Referrer-Policy` permitem o popup do GIS. O plugin local oferece o mesmo handler nas portas 5173/4173; os testes dedicados usam um verificador injetado apenas no fixture, porta 5175 e MSW real para as operações fictícias.

## Sessão e cache

Chaves públicas: `['catalog', search]`, `['nft', id]`. Chaves privadas incluem a identidade: `['cart', owner]`, `['favorites', owner]`, `['wallets', owner]`, `['order', owner, id]` e `['quote', owner, cartVersion, coupon]`. Login, logout e expiração cancelam/removem consultas privadas. Mutações conferem a identidade atual antes de publicar respostas tardias. O interceptor 401 só expira a sessão quando o token da requisição ainda é o token ativo e o erro não é `INVALID_CREDENTIALS`. Esse código indica credenciais de login incorretas e preserva a sessão atual; os demais 401 continuam invalidando o token correspondente. O evento de armazenamento do token invalida a consulta de sessão nas outras abas, que usam o estado persistido atual para revalidar a identidade.

Favoritos atualizam o cache antes da resposta e restauram o valor anterior quando há falha. Catálogo mantém a lista anterior durante filtros enquanto a consulta mais recente está pendente e cancela requisições obsoletas. Carrinho e cotação são reconciliados após mutações e eventos.

No perfil, atualizações de avatar e sessão preservam campos editados localmente. Salvar aplica a normalização do servidor apenas aos valores que não foram editados novamente durante a requisição. Leituras de imagem são canceladas e conferem o ciclo de montagem e a identidade antes de iniciar o PATCH, evitando que um avatar antigo seja enviado com a sessão de outra conta.

Consultas usam 20 segundos de validade e 5 minutos de retenção por padrão, com atualização ao focar a janela. Falhas transitórias recebem no máximo uma repetição; 401, 403, 404, 409 e 422 não são repetidos. Mutações não têm retry automático. Sessão usa 15 segundos de validade, consulta periódica a cada 30 segundos e nenhuma repetição automática; a validade do token no mock é de uma hora.

O cenário persistido `expired-session` invalida os tokens usados nas operações autenticadas até uma nova autenticação válida. Entrar por senha, cadastrar uma conta ou confirmar a demonstração social emite uma nova sessão e retorna apenas esse cenário a `success`; os demais cenários permanecem selecionados. A ação `expire` antecipa o prazo das sessões existentes e não impede um login posterior. A verificação do prazo real, o logout e as respostas 401 continuam ativos.

## Transporte em tempo real

Nos modos padrão e `google-demo`, o cliente `socket.io-client` conecta a `https://realtime.kurio.test` por WebSocket. MSW intercepta o endereço e `@mswjs/socket.io-binding` adapta handshake e frames ao protocolo Socket.IO; nenhum servidor externo recebe essa conexão. A versão 0.2.0 do binding precisa de heartbeat explícito no mock. O módulo do cliente é importado depois de instalar a interceptação, porque o Engine.IO captura o construtor WebSocket na inicialização. Na variante local `google`, o cliente conecta à origem atual e o processo Node atende o Socket.IO real, validando o token no handshake e antes de enviar cada evento privado de pedido; o logout desconecta os sockets daquele token.

Os eventos `nft.updated` e `order.updated` usam `{ eventId, resourceId, version, payload }`. `VersionGate` compara a versão com REST/cache e com o último evento aceito, mantém um histórico limitado de identificadores e protege estados terminais de pedidos. Atualizações de NFT reconciliam catálogo, detalhe, carrinho e cotação. Atualizações privadas verificam a identidade no mock e no cliente. Após reconexão, recursos ativos são invalidados e consultados por REST; a assinatura anterior é removida na troca de identidade. Pedidos pendentes também têm consulta de recuperação periódica.

O transporte usa WebSocket e não cobre fallback por polling, anexos binários ou infraestrutura distribuída Socket.IO. Nos modos com MSW, assinaturas e eventos pertencem a cada instância; o modo padrão reconcilia dados compartilhados por REST, e `google-demo` mantém dados independentes por aba. Na variante local `google`, o processo Node compartilha o banco e transmite eventos aos clientes conectados, com autorização por identidade para os pedidos.

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

Ao entrar pelo cabeçalho do carrinho, o login retorna a `/cart`; ao usar “Conectar e finalizar”, mantém `/checkout` como destino. No desktop, esses fluxos mostram o carrinho atrás do diálogo, e fechar retorna ao carrinho. A validação de redirecionamento local continua aplicada. Os controles de quantidade usam 20×30 px no desktop e círculos escuros de 24×24 px no mobile, com símbolos centralizados e estados desabilitados nos limites de estoque.

O carrinho mobile usa altura mínima da viewport e crescimento flexível do resumo, conforme a propriedade de crescimento do painel arquivado. Com poucos itens, o painel preenche a altura disponível e mantém a ação de finalizar junto ao rodapé; com listas longas e mensagens de validação, o conteúdo cresce naturalmente. As imagens permanecem quadradas também abaixo de 374 px. Em 414×896, quatro itens colocam o resumo em y=554 com altura de 342 px e a ação em y=800, conforme a referência. A ação “Continuar explorando” usa a seta do cabeçalho no mobile e o link textual no desktop; `PageHeading` aceita rótulo e hash opcionais para esse destino.

O favorito dos detalhes usa um `AuthDialog` sobre a instância atual do NFT, mantendo a URL e os estados de edição, quantidade e galeria. O diálogo compartilha o formulário e o ciclo de cancelamento com as rotas de autenticação; seus modos são locais e os provedores sociais aceitam um callback de sucesso. O favorito pendente confere NFT, token e usuário aceito antes de usar a mutação do cache privado, sendo consumido uma vez. Fechar ou mudar de NFT descarta a intenção; a devolução de foco usa o botão que abriu a janela.

## Evidências e publicação

A implementação hospedada passou por **160 testes unitários/de rede em 22 arquivos**, lint e verificação de tipos. A suíte hospedada concluiu **10 E2E em desktop/mobile** e a regressão direcionada do build de produção padrão concluiu **36 E2E**, ambas com encerramento bem-sucedido. Os relatórios [Google hospedado](reports/hosted-google/index.html) e [regressão padrão](reports/hosted-google-regression/index.html) registram essas rodadas. A suíte hospedada usa verificador Google controlado. A verificação do novo deploy e a escolha de uma conta Google externa no domínio informado ainda não estão confirmadas.

Os resultados **137 testes em 16 arquivos**, **152 E2E padrão** e **12 E2E Google local** são históricos da implementação `5fcce7a`, publicada antes desta revisão em `fd1090f`. Permanecem disponíveis o [relatório padrão](reports/google-demo-regression/index.html) e o [relatório Google local](reports/google-auth/html/index.html). Os testes Google usam verificadores controlados e não comprovam login externo ao vivo. A conferência anterior do SDK em 320, 390 e 1440 px pertence à versão local anterior. Os demais resultados abaixo são históricos das versões indicadas.

O fechamento automático do painel mobile passou por **34 E2E direcionados**, em desktop/mobile e build de produção, com zero falhas, retries, casos instáveis ou skips, além de lint e build. O [relatório dos filtros](reports/filter-review/index.html) inclui oito casos novos de coleção, rede, ordenação e preço, combinados com as regressões de catálogo, limpeza, histórico, seletor nativo e posição da página. O callback de aplicação e fechamento é usado apenas dentro do diálogo; a barra de ordenação e os filtros laterais conservam o fluxo direto. Os sliders de preço mantêm o rascunho local até o envio do formulário por **Aplicar**.

A correção posterior do carrinho passou por **14 E2E direcionados**, em produção e desktop/mobile, com um worker e zero falhas, retries, casos instáveis ou skips, além de lint e build. A [rodada direcionada](reports/cart-review/index.html) cobre quantidades, remoção, cupom, autenticação, cancelamento, retorno ao mercado e as duas comparações visuais do carrinho. A baseline mobile foi revista antes da rodada; a comparação desktop usou a baseline anterior. Doze conferências adicionais combinaram 0, 1, 4 e 8 itens com 320, 360 e 414 px, sem rolagem horizontal ou erros de página. As capturas com [um item](reports/mobile-fidelity/cart-one-item-360.png) e [quatro itens](reports/mobile-fidelity/cart-four-items-414.png) registram a composição.

Testes de domínio cobrem precisão, isolamento, estoque, idempotência, imutabilidade e versões. Testes de rede usam os handlers reais MSW. Playwright cobre os doze grupos do desafio em desktop/mobile, incluindo falhas e recuperação, além da geometria de tablet e regressões visuais das quatro páginas principais.

Na versão `061756f`, após a revisão das seis telas mobile, **77 testes unitários/de rede e 144 E2E passaram**, com lint, verificação de tipos e build. A rodada integral de produção usou desktop/mobile, um worker e zero falhas, retries, casos instáveis ou skips, incluindo as oito comparações visuais. As quatro baselines mobile foram revistas contra o PDF antes da rodada final, que executou as comparações sem atualizar snapshots; as comparações desktop passaram com as baselines anteriores. O [HTML integral](reports/e2e/index.html) está versionado; traces são retidos automaticamente quando há falhas.

Além das comparações automatizadas em 390 px, 18 capturas das seis telas em 414, 360 e 320 px registraram zero rolagem horizontal e erros de página. A [visão em 414 × 896 px](reports/mobile-fidelity/screens-414.png) reúne início, detalhes, carrinho, pagamento, login e cadastro. A conferência separou a composição visual dos dados reais das fixtures, preferências de edição e favoritos salvos. O controle Demonstração foi aberto e fechado por sua interface após a mudança para o final da página mobile.

Os oito casos novos de persistência em navegador verificam sessão e carrinho com uma aba anterior ao login, recarregamento, recuperação do cenário de expiração, logout entre abas e a consulta automática após 30 segundos. Quatorze regressões de backend cobrem estado antigo, coordenação, cadastro e credenciais concorrentes, bootstrap, timers e leituras reentrantes de socket; seis testes do interceptor verificam preservação da sessão após credenciais incorretas e invalidação correta de tokens expirados ou rejeitados. Os casos anteriores de catálogo, faixa de preço, ordenação, navegação, edições, perfil, autenticação, compra, tempo real e tablet também passaram.

Para o login contextual nos detalhes, o [HTML anterior com capturas desktop/mobile](reports/detail-auth/index.html) preserva uma seleção de 54 E2E de conta e autenticação. Os doze casos de diálogo confirmam contexto preservado, modos locais, foco, favorito único, cancelamento e retry, e também passaram na rodada integral histórica descrita acima. Os estilos das rotas de login e cadastro são separados dos diálogos, que continuam preservando a tela em que foram abertos.

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

A demonstração padrão pode ser hospedada como build estático com HTTPS, `mockServiceWorker.js` na mesma origem e fallback SPA. A configuração Vercel atual publica `google-demo` com a função de verificação incluída, sem banco ou hospedagem adicional. A variante persistente `google` continua exigindo seu backend Node, Socket.IO e armazenamento privado; publicar apenas `dist-google/` não fornece esses serviços. O preview Vite serve para conferência local. Nenhum segredo é necessário no frontend. O acervo de design, estados do navegador e arquivos temporários ficam fora do pacote publicado.

O código e os relatórios são disponibilizados no repositório público [Marlondeev/frontend-challenge-jungle](https://github.com/Marlondeev/frontend-challenge-jungle). A configuração Vercel usa Node.js 24, `npm ci`, `npm run build:google-demo`, saída `dist/`, função `/api/google-auth` e fallback SPA. O Client ID público já está incluído; após obter a URL, o candidato precisa autorizar a origem no Google Cloud. Deploy e entrega ao recrutador permanecem a cargo do candidato; enviar o repositório não publica uma URL da aplicação.
